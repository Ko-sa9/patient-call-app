const functions = require("firebase-functions");
const {TextToSpeechClient} = require("@google-cloud/text-to-speech");
const cors = require("cors")({origin: true});

// Text-to-Speechクライアントの初期化
const client = new TextToSpeechClient();

/**
 * テキストを音声に変換する関数
 */
exports.synthesizeSpeech = functions.https.onRequest((req, res) => {
  // CORSを許可
  cors(req, res, async () => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    const text = req.body.text;
    if (!text) {
      res.status(400).send("Bad Request: \"text\" argument is missing.");
      return;
    }

    const request = {
      input: {text: text},
      voice: {languageCode: "ja-JP", name: "ja-JP-Wavenet-B"},
      audioConfig: {audioEncoding: "MP3"},
    };

    try {
      const [response] = await client.synthesizeSpeech(request);
      const audioContent = response.audioContent.toString("base64");
      res.status(200).json({audioContent: audioContent});
    } catch (error) {
      console.error("Text-to-Speech API Error:", error);
      res.status(500).send(
          "Internal Server Error: Failed to synthesize speech.",
      );
    }
  });
});
