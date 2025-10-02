import React from 'react';
import CustomModal from './CustomModal';

const ConfirmationModal = ({ title, message, onConfirm, onCancel, confirmText = 'OK', confirmColor = 'blue' }) => {
    const colorClasses = {
        red: 'bg-red-600 hover:bg-red-700',
        blue: 'bg-blue-600 hover:bg-blue-700',
        green: 'bg-green-600 hover:bg-green-700',
    };

    return (
        <CustomModal
            title={title}
            onClose={onCancel}
            footer={
                <>
                    <button
                        onClick={onCancel}
                        className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-6 rounded-lg"
                    >
                        キャンセル
                    </button>
                    <button
                        onClick={onConfirm}
                        className={`${colorClasses[confirmColor] || colorClasses.blue} text-white font-bold py-2 px-6 rounded-lg`}
                    >
                        {confirmText}
                    </button>
                </>
            }
        >
            <p className="text-gray-700">{message}</p>
        </CustomModal>
    );
};

export default ConfirmationModal;
