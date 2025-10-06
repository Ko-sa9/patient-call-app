// === 1. ライブラリの読み込み (最初にすべてまとめる) ===
const functions = require("firebase-functions");
const {TextToSpeechClient} = require("@google-cloud/text-to-speech");
const cors = require("cors")({origin: true});
const kuromoji = require("kuromoji");
const path = require("path");

// === 2. 初期設定 (次にすべてまとめる) ===

// Text-to-Speechクライアントの初期化
const client = new TextToSpeechClient();

// Kuromoji (ふりがな変換) の初期化
let tokenizer = null;
const kuromojiPath = path.dirname(require.resolve("kuromoji"));
const dicPath = path.join(kuromojiPath, "../dict");
const builder = kuromoji.builder({
  dicPath: dicPath,
});

builder.build((err, t) => {
  if (err) {
    console.error("Kuromojiの初期化に失敗しました: ", err);
  } else {
    tokenizer = t;
    console.log("Kuromojiの初期化が完了しました。");
  }
});


// === 3. Cloud Functionsの定義 (ここから関数を定義) ===

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


/**
 * 漢字テキストをふりがな(カタカナ)に変換する関数
 */
exports.getFurigana = functions.https.onCall(async (data, context) => {
  if (!tokenizer) {
    const errorMessage =
      "サーバーが準備中です。少し待ってから再試行してください。";
    throw new functions.https.HttpsError("unavailable", errorMessage);
  }
  if (!data.text) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "テキストが指定されていません。",
    );
  }

  try {
    const tokens = tokenizer.tokenize(data.text);
    const furigana = tokens
        .map((token) =>
          (token.reading && token.reading !== "*") ?
            token.reading :
            token.surface_form,
        )
        .join("");
    return {furigana: furigana};
  } catch (error) {
    console.error("ふりがな変換エラー:", error);
    const errorMessage = "ふりがなへの変換中にエラーが発生しました。";
    throw new functions.https.HttpsError("internal", errorMessage);
  }
});

