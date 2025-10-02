import React from 'react';

const LoadingSpinner = ({ text = '読み込み中...' }) => {
    return (
        <div className="flex flex-col justify-center items-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            {text && <p className="mt-4 text-gray-600">{text}</p>}
        </div>
    );
};

export default LoadingSpinner;
