const axios = require('axios');
const jwt = require('jsonwebtoken');

exports.generateConsent = async (req, res) => {

    try {
        const partnerId = process.env.DHAN_PARTNER_ID;
        const partnerSecret = process.env.DHAN_PARTNER_SECRET;
        
        console.log("=== DHAN GENERATE CONSENT DEBUG ===");
        console.log("Partner ID:", `"${partnerId}"` , `(Length: ${partnerId?.length})`);
        console.log("Partner Secret:", `"${partnerSecret}"`, `(Length: ${partnerSecret?.length})`);
        
        // Set response headers to prevent hanging  
        res.set({
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });

        // Create axios instance with timeout
        const axiosInstance = axios.create({
            timeout: 10000 // 10 second timeout
        });

        const response = await axiosInstance.get(
            "https://auth.dhan.co/partner/generate-consent",
            {
                headers: {
                    "partner_id": partnerId,
                    "partner_secret": partnerSecret
                }
            }
        );

        console.log("✅ SUCCESS - Response from Dhan:", response.data);
        
        return res.status(200).json({
            status: true,
            message: "Consent generated successfully",
            data: response.data
        });

    } catch (error) {
        console.log("=== DHAN ERROR RESPONSE ===");
        console.log("Status Code:", error.response?.status);
        console.log("Error Data:", error.response?.data);
        console.log("Error Message:", error.message);
        
        return res.status(error.response?.status || 500).json({
            status: false,
            message: error.response?.data?.error || error.message,
            details: error.response?.status
        });
    }
};

exports.consumeConsent = async (req, res) => {
  try {

    const tokenId = req.body.tokenId;

    const response = await axios.get(
      `https://auth.dhan.co/partner/consume-consent?tokenId=${tokenId}`,
      {
        headers: {
          "partner_id": process.env.DHAN_PARTNER_ID,
          "partner_secret": process.env.DHAN_PARTNER_SECRET
        }
      }
    );

    const dhanData = response.data;

    const dhanClientId = dhanData.dhanClientId;
    const dhanClientName = dhanData.dhanClientName;
    const dhanAccessToken = dhanData.accessToken;

    const appToken = jwt.sign(
      {
        dhanClientId: dhanClientId
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    res.json({
      status: true,
      message: "Login successful",
      user: {
        dhanClientId,
        dhanClientName,
        dhanClientUcc: dhanData.dhanClientUcc
      },
      dhanAccessToken: dhanAccessToken,
      token: appToken
    });

  } catch (error) {
    console.log("DHAN ERROR:", error.response?.data || error.message);
    res.json({
      status: false,
      message: error.response?.data || error.message
    });
  }
};
