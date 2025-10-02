import React, { useEffect, useState, useContext } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { AppContext } from '../context/AppContext'; // AppContextをインポート
import { useAllDayPatients, updatePatientStatus } from '../App'; // フックと関数をインポート

const CustomModal = ({ title, children, onClose, footer }) => (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4">
        <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-lg">
            <div className="flex justify-between items-center border-b pb-3 mb-4">
                <h3 className="text-xl font-bold">{title}</h3>
                {onClose && <button onClick={onClose} className="text-gray-500 hover:text-gray-800 text-2xl">&times;</button>}
            </div>
            <div className="mb-6">{children}</div>
            {footer && <div className="border-t pt-4 flex justify-end space-x-3">{footer}</div>}
        </div>
    </div>
);

const QrScannerModal = ({ onClose }) => {
    const { selectedFacility, selectedDate } = useContext(AppContext);
    const { allPatients } = useAllDayPatients();
    const [scanResult, setScanResult] = useState(null);
    const [message, setMessage] = useState('');

    useEffect(() => {
        const scanner = new Html5QrcodeScanner(
            'qr-reader',
            {
                qrbox: {
                    width: 250,
                    height: 250,
                },
                fps: 5,
            },
            false
        );

        const onScanSuccess = (decodedText, decodedResult) => {
            setScanResult(decodedText);
            const patient = allPatients.find(p => p.masterPatientId === decodedText);

            if (patient) {
                if (patient.status === '治療中') {
                    updatePatientStatus(selectedFacility, selectedDate, patient.cool, patient.id, '呼出中');
                    setMessage(`${patient.name} さんを呼び出しました。`);
                } else {
                    setMessage(`${patient.name} さんは既に呼び出し済みか、退出済みです。`);
                }
            } else {
                setMessage('該当する患者が見つかりませんでした。');
            }
        };

        const onScanError = (error) => {
            // console.warn(error);
        };

        scanner.render(onScanSuccess, onScanError);

        return () => {
            scanner.clear().catch(error => {
                console.error("Failed to clear html5-qrcode-scanner.", error);
            });
        };
    }, [allPatients, selectedFacility, selectedDate]);

    return (
        <CustomModal
            title="QRコードで呼び出し"
            onClose={onClose}
            footer={<button onClick={onClose} className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-6 rounded-lg">閉じる</button>}
        >
            <div id="qr-reader"></div>
            {message && (
                <div className="mt-4 p-3 bg-blue-100 text-blue-800 rounded-lg">
                    <p className="font-semibold">最終スキャン結果:</p>
                    <p>{message}</p>
                </div>
            )}
        </CustomModal>
    );
};

export default QrScannerModal;
