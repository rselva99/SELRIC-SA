import { useState, useRef } from 'react';
import { Upload, FileText, Image, X } from 'lucide-react';
import { cn } from '../../lib/utils';

export default function FileDropZone({ onFile, accept = '*', label = 'Drop file here or click to browse', multiple = false }) {
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const inputRef = useRef();

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      setSelectedFile(files[0]);
      onFile(multiple ? Array.from(files) : files[0]);
    }
  }

  function handleChange(e) {
    const files = e.target.files;
    if (files.length > 0) {
      setSelectedFile(files[0]);
      onFile(multiple ? Array.from(files) : files[0]);
    }
  }

  function clear(e) {
    e.stopPropagation();
    setSelectedFile(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  const isPdf = selectedFile?.type === 'application/pdf';
  const isImage = selectedFile?.type?.startsWith('image/');

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={cn(
        'relative flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-xl cursor-pointer transition-all duration-200',
        dragOver
          ? 'border-brand-500 bg-brand-50'
          : selectedFile
            ? 'border-brand-300 bg-brand-50/50'
            : 'border-surface-300 bg-surface-50 hover:border-surface-400 hover:bg-surface-100'
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={handleChange}
        className="hidden"
      />
      {selectedFile ? (
        <div className="flex items-center gap-3">
          {isPdf ? <FileText size={24} className="text-brand-600" /> :
           isImage ? <Image size={24} className="text-brand-600" /> :
           <FileText size={24} className="text-brand-600" />}
          <div>
            <p className="text-sm font-medium text-surface-800">{selectedFile.name}</p>
            <p className="text-xs text-surface-500">
              {(selectedFile.size / 1024).toFixed(1)} KB
            </p>
          </div>
          <button onClick={clear} className="p-1 rounded hover:bg-surface-200">
            <X size={16} className="text-surface-500" />
          </button>
        </div>
      ) : (
        <>
          <Upload size={28} className={cn('mb-2', dragOver ? 'text-brand-600' : 'text-surface-400')} />
          <p className="text-sm text-surface-600">{label}</p>
          <p className="text-xs text-surface-400 mt-1">
            {accept === '*' ? 'Any file type' : accept.replace(/,/g, ', ')}
          </p>
        </>
      )}
    </div>
  );
}
