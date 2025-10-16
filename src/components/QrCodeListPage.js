import React from 'react';
import { QRCode } from 'qrcode.react';

// このコンポーネントは、患者リスト(patients)と戻るボタンの関数(onBack)を受け取ります
const QrCodeListPage = ({ patients, onBack }) => {
  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      {/* 印刷時には表示しないヘッダー部分 */}
      <div className="flex justify-between items-center mb-6 no-print">
        <h2 className="text-2xl font-bold">患者QRコード一覧</h2>
        <div>
          <button onClick={onBack} className="bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg mr-4">
            管理画面に戻る
          </button>
          <button onClick={() => window.print()} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg">
            このページを印刷
          </button>
        </div>
      </div>

      {/* QRコードのリスト */}
      <div className="qr-list-container">
        {patients
          .sort((a, b) => a.bed.localeCompare(b.bed, undefined, { numeric: true })) // ベッド番号でソート
          .map(patient => (
            // patientIdが存在する場合のみQRコードを生成
            patient.patientId && (
              <div key={patient.id} className="qr-patient-item">
                <h3 className="patient-name">{patient.name} 様</h3>
                <div className="qr-code-wrapper">
                  {/* 1つ目のQRコード */}
                  <div className="qr-code-box">
                    <QRCode value={patient.patientId} size={128} />
                    <span className="patient-id">{patient.patientId}</span>
                  </div>
                  {/* 2つ目のQRコード */}
                  <div className="qr-code-box">
                    <QRCode value={patient.patientId} size={128} />
                    <span className="patient-id">{patient.patientId}</span>
                  </div>
                </div>
              </div>
            )
        ))}
      </div>
    </div>
  );
};

export default QrCodeListPage;
