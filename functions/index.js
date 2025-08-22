const functions = require("firebase-functions");
const {TextToSpeechClient} = require("@google-cloud/text-to-speech");

// Text-to-Speechクライアントを初期化
const client = new TextToSpeechClient();

exports.synthesizeSpeech = functions.https.onCall(async (data, context) => {
  const text = data.text;
  if (!text) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "The function must be called with \"text\" argument.",
    );
  }

  // 音声合成のリクエストを作成
  const request = {
    input: {text: text},
    // 声質を選択 (ja-JP-Wavenet-Bは自然な女性の声)
    voice: {
      languageCode: "ja-JP",
      ssmlGender: "FEMALE",
      name: "ja-JP-Wavenet-B",
    },
    // 音声の形式を選択 (MP3)
    audioConfig: {audioEncoding: "MP3"},
  };

  try {
    // APIを呼び出し
    const [response] = await client.synthesizeSpeech(request);
    // 音声データをBase64形式の文字列として返す
    return {audioContent: response.audioContent.toString("base64")};
  } catch (error) {
    console.error("Text-to-Speech API Error:", error);
    throw new functions.https.HttpsError(
        "internal",
        "Failed to synthesize speech.",
    );
  }
});
