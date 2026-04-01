const query = require("../helpers/query");
const utility = require("../helpers/utility");

// CREATE CHALLENGE
exports.createChallenge = async (req, res) => {

    try {
        let userInfo = req?.userInfo;

        // User must be authenticated to create a challenge
        if (!userInfo || !userInfo.user_Id) {
            return res.json({
                status: false,
                message: "User authentication required"
            });
        }

        const dhanClientId = userInfo.dhan_client_id;
        const {
            tradingCapital,
            minProfit,
            maxProfit,
            minLoss,
            maxLoss,
            maxTradesPerDay,
            niftyLots,
            bankNiftyLots,
            finNiftyLots,
            midcapNiftyLots,
            sensexLots,
            challengeDays
        } = req.body?.inputdata;

        // Validation
        if (!tradingCapital || !challengeDays) {
            return res.json({
                status: false,
                message: "Trading capital and challenge days are required"
            });
        }

        const sql = `
        INSERT INTO user_challenges
        (
            dhan_client_id,
            user_id,
            trading_capital,
            min_profit,
            max_profit,
            min_loss,
            max_loss,
            max_trades_per_day,
            nifty_lots,
            banknifty_lots,
            finnifty_lots,
            midcapnifty_lots,
            sensex_lots,
            challenge_days,
            challenge_start_date,
            challenge_end_date,
            is_active,
            created_at
        )
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),DATE_ADD(NOW(), INTERVAL ? DAY),1,NOW())
        `;

        const result = await query.runQuery(sql, [
            dhanClientId,
            userInfo.user_Id,
            tradingCapital,
            minProfit,
            maxProfit,
            minLoss,
            maxLoss,
            maxTradesPerDay,
            niftyLots,
            bankNiftyLots,
            finNiftyLots,
            midcapNiftyLots,
            sensexLots,
            challengeDays,
            challengeDays
        ]);

        res.json({
            status: true,
            message: "Challenge created successfully",
            data: {
                challengeId: result.insertId
            }
        });

    } catch (error) {
        console.log("CREATE CHALLENGE ERROR:", error);
        res.json({
            status: false,
            message: error.message
        });
    }

};

// GET CURRENT CHALLENGE
exports.getCurrentChallenge = async (req, res) => {

    try {
        let userInfo = req?.userInfo;

        if (!userInfo || !userInfo.user_Id) {
            return res.json({
                status: false,
                message: "User authentication required"
            });
        }

        const dhanClientId = userInfo.dhan_client_id;
        const sql = `
        SELECT * 
        FROM user_challenges
        WHERE dhan_client_id = ?
        AND is_active = 1
        LIMIT 1
        `;

        const result = await query.runQuery(sql, [dhanClientId]);

        res.json({
            status: true,
            data: result[0] || null
        });

    } catch (error) {
        res.json({
            status: false,
            message: error.message
        });
    }
};

// CHECK ORDER RULES
exports.checkOrderRules = async (req, res) => {

    try {
        let userInfo = req?.userInfo;

        if (!userInfo || !userInfo.user_Id) {
            return res.json({
                status: false,
                message: "User authentication required"
            });
        }

        const dhanClientId = userInfo.dhan_client_id;
        let { index, quantity } = req.body?.inputdata;

        index = index?.toUpperCase();
        const cooldown = await query.runQuery(
            `SELECT * FROM challenge_pause_logs
             WHERE dhan_client_id=? 
             AND pause_end > NOW()
             ORDER BY id DESC LIMIT 1`,
            [dhanClientId]
        );

        if (cooldown.length) {
            return res.json({
                allowed: false,
                rule: "COOLDOWN_ACTIVE",
                message: "Trading paused due to cooldown",
                pause_end: cooldown[0].pause_end
            });
        }

        const challenge = await query.runQuery(
            `SELECT * FROM user_challenges 
             WHERE dhan_client_id=? 
             AND is_active=1 
             LIMIT 1`,
            [dhanClientId]
        );

        if (!challenge.length) {
            return res.json({ allowed: true });
        }

        const rules = challenge[0];
        const pnlData = await query.runQuery(
            `SELECT SUM(pnl) as total 
             FROM challenge_trade_logs
             WHERE dhan_client_id=? 
             AND trade_date=CURDATE()`,
            [dhanClientId]
        );

        const todayPnL = pnlData[0].total || 0;
        if (todayPnL <= -rules.max_loss) {

            await exports.triggerCooldown(
                dhanClientId,
                rules.id,
                "DAILY_LOSS_LIMIT"
            );

            return res.json({
                allowed: false,
                rule: "DAILY_LOSS_LIMIT",
                message: "Daily loss limit reached"
            });
        }

        if (todayPnL >= rules.max_profit) {

            await exports.triggerCooldown(
                dhanClientId,
                rules.id,
                "DAILY_PROFIT_TARGET"
            );

            return res.json({
                allowed: false,
                rule: "DAILY_PROFIT_TARGET",
                message: "Daily profit target achieved"
            });
        }

        const tradeCount = await query.runQuery(
            `SELECT COUNT(*) as total 
             FROM challenge_trade_logs
             WHERE dhan_client_id=? 
             AND trade_date=CURDATE()`,
            [dhanClientId]
        );

        const todayTrades = tradeCount[0].total || 0;
        if (todayTrades >= rules.max_trades_per_day) {
            await exports.triggerCooldown(
                dhanClientId,
                rules.id,
                "MAX_TRADES_LIMIT"
            );
            return res.json({
                allowed: false,
                rule: "MAX_TRADES_LIMIT",
                message: "Maximum trades per day reached"
            });
        }

        let allowedQty = 0;
        if (index === "NIFTY") allowedQty = rules.nifty_lots;
        if (index === "BANKNIFTY") allowedQty = rules.banknifty_lots;
        if (index === "FINNIFTY") allowedQty = rules.finnifty_lots;
        if (index === "MIDCAPNIFTY") allowedQty = rules.midcapnifty_lots;
        if (index === "SENSEX") allowedQty = rules.sensex_lots;

        if (quantity > allowedQty) {

            return res.json({
                allowed: false,
                rule: "QUANTITY_RULE",
                message: `Quantity limit exceeded. Allowed ${allowedQty}`
            });
        }
        res.json({
            allowed: true
        });

    } catch (error) {
        console.log("RULE CHECK ERROR:", error);
        res.json({
            allowed: false,
            message: error.message
        });
    }
};

exports.logTrade = async (req, res) => {

    try {
        let userInfo = req?.userInfo;

        if (!userInfo || !userInfo.user_Id) {
            return res.json({
                status: false,
                message: "User authentication required"
            });
        }

        const dhanClientId = userInfo.dhan_client_id;

        const { index, quantity, pnl } = req.body?.inputdata;
        const challenge = await query.runQuery(
            "SELECT id FROM user_challenges WHERE dhan_client_id=? AND is_active=1 LIMIT 1",
            [dhanClientId]
        );

        const challengeId = challenge.length ? challenge[0].id : null;
        const sql = `
        INSERT INTO challenge_trade_logs
        (
            dhan_client_id,
            challenge_id,
            index_name,
            quantity,
            pnl,
            trade_date,
            created_at
        )
        VALUES (?,?,?,?,?,CURDATE(),NOW())
        `;
        await query.runQuery(sql, [
            dhanClientId,
            challengeId,
            index,
            quantity,
            pnl
        ]);

        res.json({
            status: true,
            message: "Trade logged successfully"
        });
    } catch (error) {
        console.log("TRADE LOG ERROR:", error);
        res.json({
            status: false,
            message: error.message
        });
    }
};

exports.checkCooldown = async (req, res) => {

    try {
        let userInfo = req?.userInfo;

        if (!userInfo || !userInfo.user_Id) {
            return res.json({
                status: false,
                message: "User authentication required"
            });
        }

        const dhanClientId = userInfo.dhan_client_id;
        const pause = await query.runQuery(
            `SELECT * FROM challenge_pause_logs
             WHERE dhan_client_id=?
             AND pause_end > NOW()
             ORDER BY id DESC
             LIMIT 1`,
            [dhanClientId]
        );

        if (pause.length) {
            return res.json({
                allowed: false,
                rule: "COOLDOWN_ACTIVE",
                message: "Trading paused due to rule trigger",
                pause_end: pause[0].pause_end
            });
        }

        res.json({
            allowed: true
        });
    } catch (error) {
        console.log("COOLDOWN ERROR:", error);
        res.json({
            allowed: false,
            message: error.message
        });
    }
};

exports.triggerCooldown = async (dhanClientId, challengeId, rule) => {
    try {
        await query.runQuery(
            `INSERT INTO challenge_pause_logs
            (
                dhan_client_id,
                challenge_id,
                rule_triggered,
                pause_start,
                pause_end,
                created_at
            )
            VALUES (?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 30 MINUTE), NOW())`,
            [
                dhanClientId,
                challengeId,
                rule
            ]
        );

    } catch (error) {
        console.log("COOLDOWN INSERT ERROR:", error);
    }
};

exports.quickUnlock = async (req, res) => {
    try {
        let userInfo = req?.userInfo;

        if (!userInfo || !userInfo.user_Id) {
            return res.json({
                status: false,
                message: "User authentication required"
            });
        }

        const dhanClientId = userInfo.dhan_client_id;
        const pause = await query.runQuery(
            `SELECT * FROM challenge_pause_logs
             WHERE dhan_client_id=?
             AND pause_end > NOW()
             ORDER BY id DESC
             LIMIT 1`,
            [dhanClientId]
        );

        if (!pause.length) {
            return res.json({
                status: false,
                message: "No active cooldown"
            });
        }
        await query.runQuery(
            `UPDATE challenge_pause_logs
             SET pause_end = NOW(),
             quick_unlock_used = 1,
             updated_at = NOW()
             WHERE id=?`,
            [pause[0].id]
        );
        res.json({
            status: true,
            message: "Trading resumed successfully"
        });
    } catch (error) {
        console.log("UNLOCK ERROR:", error);
        res.json({
            status: false,
            message: error.message
        });
    }
};
