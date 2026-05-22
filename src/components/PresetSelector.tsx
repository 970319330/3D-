import React, { useRef } from 'react';
import { FileArchive, Upload, FileText, Image, Trash2, Plus } from 'lucide-react';

interface PresetSelectorProps {
  activeModelType: 'cylinder' | 'capsule' | 'humanoid' | 'box' | 'gltf';
  onSelectPreset: (type: 'cylinder' | 'capsule' | 'humanoid' | 'box' | 'gltf') => void;
  onCustomFileLoaded: (file: File) => void;
  customFile: File | null;
  customTextureFile: File | null;
  onCustomTextureLoaded: (file: File | null) => void;
  customMtlFile: File | null;
  onCustomMtlLoaded: (file: File | null) => void;
  customTextureFiles: File[];
  onCustomTextureFilesLoaded: (files: File[]) => void;
  onUnloadModel: () => void;
}

export default function PresetSelector({
  activeModelType,
  onSelectPreset,
  onCustomFileLoaded,
  customFile,
  customTextureFile,
  onCustomTextureLoaded,
  customMtlFile,
  onCustomMtlLoaded,
  customTextureFiles,
  onCustomTextureFilesLoaded,
  onUnloadModel
}: PresetSelectorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textureInputRef = useRef<HTMLInputElement>(null);
  const mtlInputRef = useRef<HTMLInputElement>(null);
  const multiTexturesInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const modelFileArray: File[] = [];
      const textureFileArray: File[] = [];
      let mtlFile: File | null = null;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const extension = file.name.split('.').pop()?.toLowerCase();
        if (['gltf', 'glb', 'obj', 'fbx'].includes(extension || '')) {
          modelFileArray.push(file);
        } else if (extension === 'mtl') {
          mtlFile = file;
        } else if (['png', 'jpg', 'jpeg', 'tga', 'bin'].includes(extension || '')) {
          textureFileArray.push(file);
        }
      }

      if (modelFileArray.length > 0) {
        onCustomFileLoaded(modelFileArray[0]);
        if (mtlFile) {
          onCustomMtlLoaded(mtlFile);
        }
        if (textureFileArray.length > 0) {
          onCustomTextureFilesLoaded(textureFileArray);
        }
        onSelectPreset('gltf');
      } else {
        // Fallback for single file drop
        const file = files[0];
        const extension = file.name.split('.').pop()?.toLowerCase();
        if (['gltf', 'glb', 'obj', 'fbx'].includes(extension || '')) {
          onCustomFileLoaded(file);
          onSelectPreset('gltf');
        }
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const modelFileArray: File[] = [];
      const textureFileArray: File[] = [];
      let mtlFile: File | null = null;
      
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const extension = file.name.split('.').pop()?.toLowerCase();
        if (['gltf', 'glb', 'obj', 'fbx'].includes(extension || '')) {
          modelFileArray.push(file);
        } else if (extension === 'mtl') {
          mtlFile = file;
        } else if (['png', 'jpg', 'jpeg', 'tga', 'bin'].includes(extension || '')) {
          textureFileArray.push(file);
        }
      }

      if (modelFileArray.length > 0) {
        onCustomFileLoaded(modelFileArray[0]);
        if (mtlFile) {
          onCustomMtlLoaded(mtlFile);
        }
        if (textureFileArray.length > 0) {
          onCustomTextureFilesLoaded(textureFileArray);
        }
        onSelectPreset('gltf');
      } else {
        // Fallback
        const file = files[0];
        const extension = file.name.split('.').pop()?.toLowerCase();
        if (['gltf', 'glb', 'obj', 'fbx'].includes(extension || '')) {
          onCustomFileLoaded(file);
          onSelectPreset('gltf');
        }
      }
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Upload Drag and Drop zone */}
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-slate-400 tracking-wider uppercase">导入外部3D模型</h3>
        
        <div
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition duration-150 flex flex-col items-center justify-center gap-2 ${
            activeModelType === 'gltf'
              ? 'border-indigo-500 bg-indigo-500/5 text-indigo-300'
              : 'border-slate-800 bg-slate-900/10 text-slate-400 hover:border-slate-700 hover:bg-slate-900/30'
          }`}
        >
          <Upload className={`w-6 h-6 ${activeModelType === 'gltf' ? 'text-indigo-400' : 'text-slate-500'}`} />
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-semibold">
              {activeModelType === 'gltf' && customFile ? customFile.name : '点击或拖曳多个模型/材质包'}
            </span>
            <span className="text-[10px] text-slate-500">
              支持直接多选/拖入 .gltf, .glb, .fbx 或 .obj + .mtl + 贴图图片
            </span>
          </div>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".gltf,.glb,.obj,.mtl,.fbx,.png,.jpg,.jpeg,.tga,.bin"
            multiple
            className="hidden"
          />
        </div>

        {activeModelType === 'gltf' && customFile && (
          <div className="flex flex-col gap-3">
            <div className="bg-slate-900/50 border border-slate-800 p-2.5 rounded-lg flex items-center justify-between text-xs text-slate-300">
              <div className="flex items-center gap-2 overflow-hidden mr-2">
                <FileArchive className="w-4 h-4 text-sky-400 shrink-0" />
                <div className="flex flex-col overflow-hidden">
                  <span className="font-medium truncate text-slate-200">{customFile.name}</span>
                  <span className="text-[10px] text-slate-500">已载入网页内存中</span>
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onUnloadModel();
                }}
                className="text-[10px] bg-slate-800 hover:bg-slate-705 px-2 py-1 rounded text-red-400 hover:text-red-300 transition"
              >
                卸载模型
              </button>
            </div>

            {/* MTL Material Block (Directly display and upload) */}
            {customFile.name.endsWith('.obj') && (
              <div className="bg-slate-900/40 border border-[#1e293b] p-3 rounded-lg flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-sky-450 uppercase tracking-wide flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-sky-455 shrink-0" />
                    <span>MTL 材质文件定义</span>
                  </span>
                  {customMtlFile && (
                    <button
                      onClick={() => onCustomMtlLoaded(null)}
                      className="text-[9px] text-red-400 hover:text-red-300 transition"
                    >
                      清除材质
                    </button>
                  )}
                </div>
                
                {customMtlFile ? (
                  <div className="bg-slate-950/50 px-2 py-1.5 rounded text-[11px] font-mono text-slate-300 flex items-center justify-between">
                    <span className="truncate max-w-[180px]">{customMtlFile.name}</span>
                    <span className="text-[9px] text-[#10b981] font-sans font-medium">已连接</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => mtlInputRef.current?.click()}
                    className="py-1.5 border border-dashed border-slate-800 hover:border-sky-500 hover:bg-sky-500/5 text-slate-400 hover:text-sky-300 rounded text-[10px] font-medium flex items-center justify-center gap-1.5 transition cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>选择上传并添加 .mtl 材质文件</span>
                  </button>
                )}
                <input
                  type="file"
                  ref={mtlInputRef}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onCustomMtlLoaded(file);
                  }}
                  accept=".mtl"
                  className="hidden"
                />
              </div>
            )}

            {/* Multiple Textures and Companion Files Block (OBJ, GLTF/GLB) */}
            {(customFile.name.endsWith('.obj') || customFile.name.endsWith('.gltf') || customFile.name.endsWith('.glb')) && (
              <div className="bg-slate-900/40 border border-[#1e293b] p-3 rounded-lg flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-emerald-405 uppercase tracking-wide flex items-center gap-1.5">
                    <Image className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>关联支持文件库 ({customTextureFiles.length} 个文件)</span>
                  </span>
                  {customTextureFiles.length > 0 && (
                    <button
                      onClick={() => onCustomTextureFilesLoaded([])}
                      className="text-[9px] text-red-400 hover:text-red-300 transition"
                    >
                      全部清空
                    </button>
                  )}
                </div>

                {/* Upload button for multiple textures / companion files */}
                <button
                  type="button"
                  onClick={() => multiTexturesInputRef.current?.click()}
                  className="py-1.5 border border-dashed border-slate-800 hover:border-emerald-500 hover:bg-emerald-500/5 text-slate-400 hover:text-emerald-300 rounded text-[10px] font-medium flex items-center justify-center gap-1.5 transition cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>批次加入关联支持文件 (.bin/png/jpg)</span>
                </button>
                <input
                  type="file"
                  ref={multiTexturesInputRef}
                  onChange={(e) => {
                    const files = e.target.files;
                    if (files && files.length > 0) {
                      const loadedArray = Array.from(files) as File[];
                      onCustomTextureFilesLoaded([...customTextureFiles, ...loadedArray]);
                    }
                  }}
                  accept=".png,.jpg,.jpeg,.bin"
                  multiple
                  className="hidden"
                />

                {/* Display list of uploaded textures and companion files */}
                {customTextureFiles.length > 0 && (
                  <div className="flex flex-col gap-1 max-h-[120px] overflow-y-auto custom-scrollbar bg-slate-950/40 p-1.5 rounded border border-slate-800/50">
                    {customTextureFiles.map((file, idx) => (
                      <div key={idx} className="flex items-center justify-between text-[11px] hover:bg-slate-900/40 px-1.5 py-0.5 rounded text-slate-300">
                        <span className="truncate max-w-[200px] text-slate-300 font-mono text-[10px]">{file.name}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const updated = customTextureFiles.filter((_, i) => i !== idx);
                            onCustomTextureFilesLoaded(updated);
                          }}
                          className="p-1 hover:text-red-400 text-slate-500 transition"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Single projecting fallback texture if no mtl */}
            {!customMtlFile && (
              <div className="bg-slate-900/30 border border-slate-800/60 p-2.5 rounded-lg flex flex-col gap-1.5">
                <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wide">单图全局映射投影</span>
                <p className="text-[10px] text-slate-500 leading-normal">
                  无需 .mtl 控制，直接强制投影单张大图作为全局 3D 模型贴图
                </p>
                <button
                  type="button"
                  onClick={() => textureInputRef.current?.click()}
                  className="py-1 px-3 bg-indigo-600/20 hover:bg-indigo-600 text-indigo-100 border border-indigo-500/20 rounded text-[11px] font-medium flex items-center justify-center gap-1.5 transition cursor-pointer"
                >
                  <Upload className="w-3 h-3" />
                  <span>{customTextureFile ? '更新全局贴图 (PNG/JPG)' : '选择单张贴图图片'}</span>
                </button>
                <input
                  type="file"
                  ref={textureInputRef}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onCustomTextureLoaded(file);
                  }}
                  accept=".png,.jpg,.jpeg"
                  className="hidden"
                />

                {customTextureFile && (
                  <div className="bg-slate-950/40 border border-slate-800/80 p-1.5 rounded flex items-center justify-between text-[10px] text-slate-350">
                    <span className="truncate max-w-[130px] font-medium text-emerald-400 font-mono">{customTextureFile.name}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onCustomTextureLoaded(null);
                      }}
                      className="text-[9px] bg-slate-900 hover:bg-slate-800 px-1 py-0.5 rounded text-red-450 hover:text-red-400 transition"
                    >
                      卸载贴图
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-slate-900/30 p-3 rounded-lg border border-slate-800/40 text-[11px] text-slate-500 flex flex-col gap-1.5 leading-relaxed select-none">
        <p className="font-semibold text-slate-400">💡 友情提醒：</p>
        <p>1. 导入您自己的 3D 模型（如 <code>.glb</code> / <code>.gltf</code> / <code>.fbx</code> / <code>.obj</code>）后，即可在这款高动态 PBR 展厅中即时渲染预览。</p>
        <p>2. 如果模型本身不带内置骨骼动画，您可以切换到 “编辑骨骼” 模式为它添加骨骼节点，一键完成快速蒙皮，即可自定给模型跳舞啦！</p>
      </div>
    </div>
  );
}
