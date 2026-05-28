import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { formatDate } from '../../lib/utils';
import Spinner from '../../components/ui/Spinner';
import toast from 'react-hot-toast';
import {
  Megaphone, ChevronDown, ChevronRight, Upload, Trash2,
  Printer, ImageDown, Clock, Tag, X,
} from 'lucide-react';

const ASSET_TAGS = ['Logo', 'Venue', 'Menu', 'Team Logo', 'Drink Special', 'Staff', 'Other'];

export default function MarketingPage() {
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState(null); // { flyer_html, social_html, prompt }
  const [previewTab, setPreviewTab] = useState('flyer');
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [feedOpen, setFeedOpen] = useState(true);
  const [assets, setAssets] = useState([]);
  const [uploadingAsset, setUploadingAsset] = useState(false);
  const [newTag, setNewTag] = useState('Logo');
  const [downloadingImage, setDownloadingImage] = useState(false);

  const flyerRef  = useRef(null);
  const socialRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    loadHistory();
    loadAssets();
  }, []);

  async function loadHistory() {
    try {
      const { data } = await supabase.from('marketing_materials').select('*').order('created_at', { ascending: false }).limit(20);
      setHistory(data || []);
    } finally { setLoadingHistory(false); }
  }

  async function loadAssets() {
    const { data } = await supabase.from('marketing_assets').select('*').order('created_at', { ascending: false });
    setAssets(data || []);
  }

  async function getAssetSignedUrl(fileUrl) {
    const { data } = await supabase.storage.from('marketing-assets').createSignedUrl(fileUrl, 3600);
    return data?.signedUrl || '';
  }

  async function handleAssetUpload(files) {
    if (!files.length) return;
    setUploadingAsset(true);
    try {
      for (const file of files) {
        if (file.size > 5 * 1024 * 1024) { toast.error(`${file.name} exceeds 5MB`); continue; }
        const path = `${Date.now()}_${file.name}`;
        const { data: uploadData, error: upErr } = await supabase.storage.from('marketing-assets').upload(path, file);
        if (upErr) throw upErr;
        const { error: dbErr } = await supabase.from('marketing_assets').insert({
          file_url: uploadData.path,
          file_name: file.name,
          tag: newTag,
        });
        if (dbErr) throw dbErr;
      }
      toast.success('Asset uploaded');
      loadAssets();
    } catch (err) { toast.error(err.message || 'Upload failed'); }
    finally { setUploadingAsset(false); if (fileInputRef.current) fileInputRef.current.value = ''; }
  }

  async function handleDeleteAsset(asset) {
    await supabase.storage.from('marketing-assets').remove([asset.file_url]);
    await supabase.from('marketing_assets').delete().eq('id', asset.id);
    setAssets((prev) => prev.filter((a) => a.id !== asset.id));
    toast.success('Asset removed');
  }

  async function handleGenerate(e) {
    e.preventDefault();
    if (!prompt.trim()) { toast.error('Enter a prompt first'); return; }
    setGenerating(true);
    try {
      const assetDescriptions = assets.map((a) => `${a.tag}: ${a.file_name}`);
      const res = await fetch('/api/marketing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), assetDescriptions }),
      });
      if (!res.ok) throw new Error(`Generation failed (${res.status})`);
      const { flyer_html, social_html } = await res.json();
      if (!flyer_html || !social_html) throw new Error('AI returned incomplete response');

      setPreview({ flyer_html, social_html, prompt: prompt.trim() });
      setPreviewTab('flyer');

      // Save to history
      await supabase.from('marketing_materials').insert({ prompt: prompt.trim(), flyer_html, social_html });
      loadHistory();
      toast.success('Marketing materials generated!');
    } catch (err) { toast.error(err.message || 'Generation failed'); }
    finally { setGenerating(false); }
  }

  function printFlyer(html) {
    const win = window.open('', '_blank');
    if (!win) { toast.error('Pop-up blocked — allow pop-ups for this site'); return; }
    win.document.write(html);
    win.document.close();
    setTimeout(() => { win.focus(); win.print(); }, 800);
  }

  async function downloadSocialAsImage(html) {
    setDownloadingImage(true);
    try {
      const { default: html2canvas } = await import('html2canvas');
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      const container = document.createElement('div');
      container.style.cssText = 'position:fixed;left:-99999px;top:0;width:1080px;height:1080px;overflow:hidden;z-index:-1;';
      // Copy body styles and inject inline styles from document
      const bodyStyle = doc.body.getAttribute('style') || '';
      container.setAttribute('style', container.style.cssText + bodyStyle);
      container.innerHTML = doc.body.innerHTML;

      // Copy style tags
      doc.querySelectorAll('style').forEach((s) => {
        const el = document.createElement('style');
        el.textContent = s.textContent;
        container.prepend(el);
      });

      document.body.appendChild(container);

      const canvas = await html2canvas(container, {
        width: 1080, height: 1080, scale: 1,
        useCORS: true, logging: false, allowTaint: true,
      });
      document.body.removeChild(container);

      const link = document.createElement('a');
      link.download = `social-post-${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      toast.success('Image downloaded');
    } catch (err) {
      toast.error('Download failed — try right-clicking the preview and saving');
      console.error(err);
    } finally { setDownloadingImage(false); }
  }

  function loadFromHistory(item) {
    setPreview({ flyer_html: item.flyer_html, social_html: item.social_html, prompt: item.prompt });
    setPreviewTab('flyer');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="page-title flex items-center gap-2"><Megaphone size={22} className="text-brand-600" /> Marketing</h1>
          <p className="text-surface-500 text-sm mt-0.5">AI-generated flyers & social posts for TheBar</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

        {/* ── FEED ME panel ── */}
        <div className="lg:col-span-1">
          <div className="card overflow-hidden">
            <button
              onClick={() => setFeedOpen((o) => !o)}
              className="w-full flex items-center justify-between px-4 py-3 bg-surface-50 hover:bg-surface-100 transition border-b border-surface-100"
            >
              <span className="font-semibold text-sm flex items-center gap-2">
                <Upload size={15} className="text-brand-500" /> Feed Me
              </span>
              {feedOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>

            {feedOpen && (
              <div className="p-4 space-y-4">
                <p className="text-xs text-surface-500">Upload logos, photos, menus — the AI references these when generating.</p>

                <div className="flex gap-2">
                  <select value={newTag} onChange={(e) => setNewTag(e.target.value)} className="input-field text-sm py-1.5 flex-1">
                    {ASSET_TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleAssetUpload(Array.from(e.target.files))} />
                  <button onClick={() => fileInputRef.current?.click()} disabled={uploadingAsset} className="btn-secondary text-xs px-3 py-1.5 shrink-0">
                    {uploadingAsset ? <Spinner size="sm" /> : <Upload size={14} />}
                  </button>
                </div>

                {assets.length === 0 ? (
                  <p className="text-xs text-surface-400 text-center py-4">No assets yet</p>
                ) : (
                  <div className="space-y-2">
                    {assets.map((a) => (
                      <AssetThumbnail key={a.id} asset={a} onDelete={handleDeleteAsset} getUrl={getAssetSignedUrl} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Main content ── */}
        <div className="lg:col-span-3 space-y-6">

          {/* Prompt form */}
          <div className="card p-5">
            <form onSubmit={handleGenerate} className="space-y-3">
              <label className="block text-sm font-semibold text-surface-700">Describe your event or promotion</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="input-field resize-none"
                rows={3}
                placeholder='e.g. "Penny pitchers this Wednesday starting at 9pm. Blues game on all TVs."'
              />
              <button type="submit" disabled={generating || !prompt.trim()} className="btn-primary w-full">
                {generating ? <><Spinner size="sm" className="text-white" /> Generating...</> : <><Megaphone size={16} /> Generate Marketing Materials</>}
              </button>
            </form>
          </div>

          {/* Preview */}
          {preview && (
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-surface-100 bg-surface-50">
                <div className="flex gap-1 bg-surface-200 rounded-lg p-0.5">
                  {['flyer', 'social'].map((tab) => (
                    <button key={tab} onClick={() => setPreviewTab(tab)}
                      className={`px-4 py-1.5 rounded-md text-sm font-medium transition capitalize ${previewTab === tab ? 'bg-white shadow-sm text-surface-900' : 'text-surface-500 hover:text-surface-700'}`}>
                      {tab === 'flyer' ? '📄 Flyer (8.5×11)' : '📱 Social Post (1080×1080)'}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  {previewTab === 'flyer' ? (
                    <button onClick={() => printFlyer(preview.flyer_html)} className="btn-secondary text-xs flex items-center gap-1.5">
                      <Printer size={14} /> Print / Save PDF
                    </button>
                  ) : (
                    <button onClick={() => downloadSocialAsImage(preview.social_html)} disabled={downloadingImage} className="btn-secondary text-xs flex items-center gap-1.5">
                      {downloadingImage ? <Spinner size="sm" /> : <ImageDown size={14} />} Download PNG
                    </button>
                  )}
                  <button onClick={() => setPreview(null)} className="p-1.5 hover:bg-surface-100 rounded-lg"><X size={16} /></button>
                </div>
              </div>

              <div className="p-4 flex items-start justify-center bg-surface-100 min-h-[400px] overflow-hidden">
                {previewTab === 'flyer' ? (
                  <div className="relative" style={{ width: 374, height: 484 }}>
                    <iframe
                      ref={flyerRef}
                      srcDoc={preview.flyer_html}
                      title="Flyer Preview"
                      style={{ width: 850, height: 1100, transform: 'scale(0.44)', transformOrigin: 'top left', border: 'none', boxShadow: '0 4px 24px rgba(0,0,0,0.18)' }}
                      sandbox="allow-same-origin"
                    />
                  </div>
                ) : (
                  <div className="relative" style={{ width: 378, height: 378 }}>
                    <iframe
                      ref={socialRef}
                      srcDoc={preview.social_html}
                      title="Social Post Preview"
                      style={{ width: 1080, height: 1080, transform: 'scale(0.35)', transformOrigin: 'top left', border: 'none', boxShadow: '0 4px 24px rgba(0,0,0,0.18)' }}
                      sandbox="allow-same-origin"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* History */}
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-surface-100 bg-surface-50 flex items-center gap-2">
              <Clock size={15} className="text-surface-400" />
              <h3 className="font-semibold text-sm">Generation History</h3>
            </div>

            {loadingHistory ? (
              <div className="flex items-center justify-center py-10"><Spinner /></div>
            ) : history.length === 0 ? (
              <p className="text-sm text-surface-400 text-center py-10">No history yet — generate your first materials above</p>
            ) : (
              <div className="divide-y divide-surface-50">
                {history.map((item) => (
                  <div key={item.id} className="px-5 py-3 flex items-center justify-between hover:bg-surface-50 transition">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{item.prompt}</p>
                      <p className="text-xs text-surface-400">{formatDate(item.created_at)}</p>
                    </div>
                    <button onClick={() => loadFromHistory(item)} className="btn-ghost text-xs ml-4 shrink-0">Load</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AssetThumbnail({ asset, onDelete, getUrl }) {
  const [url, setUrl] = useState('');
  useEffect(() => { getUrl(asset.file_url).then(setUrl); }, [asset.file_url]); // eslint-disable-line

  return (
    <div className="flex items-center gap-2 p-2 bg-surface-50 rounded-lg">
      {url ? (
        <img src={url} alt={asset.file_name} className="w-10 h-10 rounded object-cover border border-surface-200 shrink-0" />
      ) : (
        <div className="w-10 h-10 rounded bg-surface-200 shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{asset.file_name}</p>
        <span className="text-[10px] bg-brand-100 text-brand-700 px-1.5 py-0.5 rounded-full font-medium inline-flex items-center gap-0.5">
          <Tag size={9} /> {asset.tag}
        </span>
      </div>
      <button onClick={() => onDelete(asset)} className="p-1 hover:text-red-500 text-surface-400 transition shrink-0">
        <Trash2 size={13} />
      </button>
    </div>
  );
}
