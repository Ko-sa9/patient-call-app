// ▼ useState をインポート
import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

// このコンポーネントは、患者リスト(patients)と戻るボタンの関数(onBack)を受け取ります
const QrCodeListPage = ({ patients, onBack }) => {
  // ▼ 選択された患者のIDを管理するためのstateを追加
  const [selectedIds, setSelectedIds] = useState([]);

  // ▼ チェックボックスが変更されたときの処理
  const handleSelectionChange = (patientId) => {
    setSelectedIds(prevSelectedIds => {
      // 既に選択されていたら解除、されていなければ追加
      if (prevSelectedIds.includes(patientId)) {
        return prevSelectedIds.filter(id => id !== patientId);
      } else {
        return [...prevSelectedIds, patientId];
      }
    });
  };

  // ▼ 全選択/全解除の処理
  const handleSelectAll = () => {
    // patientIdが存在する全ての患者IDを取得してstateにセット
    const allPatientIds = patients.filter(p => p.patientId).map(p => p.id);
    setSelectedIds(allPatientIds);
  };
  const handleDeselectAll = () => {
    setSelectedIds([]);
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      {/* 印刷時には表示しないヘッダー部分 */}
      <div className="flex justify-between items-center mb-6 no-print">
        <h2 className="text-2xl font-bold">患者QRコード一覧</h2>
        <div>
          {/* ▼ 全選択・全解除ボタンを追加 */}
          <button onClick={handleSelectAll} className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg mr-2">
            すべて選択
          </button>
          <button onClick={handleDeselectAll} className="bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-2 px-4 rounded-lg mr-4">
            すべて解除
          </button>
          <button onClick={onBack} className="bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg mr-4">
            管理画面に戻る
          </button>
          <button onClick={() => window.print()} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg">
            選択したものを印刷
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
              // ▼ 選択されていない場合に、印刷時に非表示にするためのクラスを動的に追加
              <div key={patient.id} className={`qr-patient-item ${!selectedIds.includes(patient.id) ? 'not-selected-for-print' : ''}`}>
                <div className="patient-header">
                  {/* ▼ チェックボックスを追加 */}
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(patient.id)}
                    onChange={() => handleSelectionChange(patient.id)}
                    className="print-checkbox no-print" // 印刷時にはチェックボックス自体も非表示にする
                  />
                  <h3 className="patient-name">{patient.name} 様</h3>
                </div>
                <div className="qr-code-wrapper">
                  {/* 1つ目のQRコード */}
                  <div className="qr-code-box">
                    <QRCodeSVG value={patient.patientId} />
                    <span className="patient-id">{patient.patientId}</span>
                  </div>
                  {/* 2つ目のQRコード */}
                  <div className="qr-code-box">
                    <QRCodeSVG value={patient.patientId} />
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