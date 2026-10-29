'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, ExternalLink, Loader2, Upload, X, Sparkles } from 'lucide-react';
import type { StyleJob } from '@/lib/api';

interface Props {
  job: StyleJob;
}

// Human-in-the-loop template. The operator pastes this into GPT/Midjourney
// along with the hijob reference image; GPT generates the mannequin itself.
// The result image is uploaded back via the "Natija URL" field or auto-upload
// from the Chrome extension.
function buildPrompt(job: StyleJob): string {
  const style =
    job.tyingStyle === 'loose'
      ? 'loose, flowing drape style'
      : job.tyingStyle === 'double'
      ? 'double-layered formal style'
      : 'classical neat wrap style';
  // targetSize is the SCARF dimension in cm (e.g. "110x110"), not a body size.
  const scarfLine = job.targetSize
    ? `Scarf size: ${job.targetSize} cm — show the full fabric length draping down.`
    : 'Scarf size: standard square — show the full fabric length draping down.';
  return [
    'Full-body photograph of a modest-fashion mannequin wearing the attached hijab.',
    '',
    'FRAMING: HEAD-TO-TOE full-body shot. The ENTIRE mannequin must be visible from the top of the head all the way DOWN TO THE FEET — including head, neck, shoulders, chest, waist, hips, legs, knees, and feet standing on the ground. Do NOT crop anywhere; feet must be inside the frame. Portrait 3:4 or 4:5 aspect ratio. Mannequin centered, standing straight.',
    '',
    `Tying style: ${style}.`,
    `Primary color accent: ${job.colorHex}.`,
    scarfLine,
    '',
    'Mannequin:',
    '• Standard full-body female fashion mannequin, neutral off-white matte finish.',
    '• Faceless — no eyes, nose, or mouth. Smooth blank oval where the face would be.',
    '• Realistic proportions, head to feet: head, neck, shoulders, chest, waist, hips, thighs, knees, calves and ankles — all in natural ratio.',
    '• FULLY MODEST OUTFIT: plain WHITE long-sleeve ankle-length dress (an abaya-like simple white gown). It covers the whole body — long sleeves to the wrists, closed high neckline, hem reaching the ankles. No skin exposed on the midriff, arms, chest, legs or ankles.',
    '• Plain WHITE closed flat shoes on the feet — no bare feet.',
    '• Standing upright on both feet, arms relaxed along the body.',
    "• ORIENTATION (MANDATORY): body and head BOTH turned slightly to the viewer's RIGHT at a three-quarter angle (~15–20°) so the camera clearly sees the RIGHT side of the face/head. NEVER turned to the left, NEVER full-front, NEVER in profile.",
    '',
    'Head + neck cover (MANDATORY — DO NOT render as a shawl or scarf):',
    '• Use the attached fabric image ONLY as a colour / pattern / texture reference. Do NOT drape it as a shawl.',
    "• Garment shape: a fitted BALACLAVA-STYLE head cover combined with a short MOCK-TURTLENECK COLLAR. Think of a one-piece sport balaclava, or a nun's wimple, or a snug ninja hood — NOT a shawl, NOT a stole, NOT a scarf hanging on the chest.",
    '• Head part: smooth, close-fitting cap over the skull, fully covering hair / forehead / ears. No loose fabric around the face oval.',
    '• Neck part: a short tube of the same fabric around the neck, ending HIGH at the base of the throat (collar height, roughly 2 cm above the collarbone). The bottom edge is a clean horizontal line at throat level — like the top edge of a mock-neck sweater.',
    '• ABSOLUTELY NO fabric descends onto the chest, shoulders in front, or over the dress neckline. Zero drape, zero folds, zero triangular panels. Collarbone and dress collar visible immediately below the fabric edge.',
    '• Symmetric on both sides. No visible pins, clips, brooches or seams.',
    '• The dress and shoes beneath remain fully visible — no bare skin exposed anywhere.',
    '',
    'Scene:',
    '• Studio lighting, soft shadow under the feet.',
    '• Clean off-white (#F5F0E6) seamless background.',
    '• Small vertical margin above the head AND below the feet so the whole figure sits comfortably in frame.',
    '• No watermarks, no text, no accessories other than the hijab.',
    '',
    'Return a single photorealistic image at 1024×1280 (4:5 portrait), full body from head to feet.',
  ].join('\n');
}

export function JobCard({ job }: Props) {
  const router = useRouter();
  const [resultUrl, setResultUrl] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<null | 'complete' | 'fail' | 'upload'>(null);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prompt = buildPrompt(job);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API blocked — show the textarea so the operator can select.
    }
  };

  const complete = async () => {
    if (!resultUrl.trim()) return;
    setBusy('complete');
    try {
      const res = await fetch(`/api/dev-ai/${job.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resultUrl: resultUrl.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch (e: any) {
      alert(e?.message ?? 'Yuborilmadi');
    } finally {
      setBusy(null);
    }
  };

  const upload = async (file: File) => {
    setBusy('upload');
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      const res = await fetch(`/api/dev-ai/${job.id}/upload`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch (e: any) {
      alert(e?.message ?? 'Yuklanmadi');
    } finally {
      setBusy(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const fail = async () => {
    if (!reason.trim()) {
      alert('Rad sababini kiriting');
      return;
    }
    setBusy('fail');
    try {
      const res = await fetch(`/api/dev-ai/${job.id}/fail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: reason.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch (e: any) {
      alert(e?.message ?? 'Yuborilmadi');
    } finally {
      setBusy(null);
    }
  };

  const settled = job.status === 'done' || job.status === 'failed';

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs text-muted mb-0.5">
            {job.seller?.brandName ?? 'noma\'lum sotuvchi'} · {new Date(job.createdAt).toLocaleString()}
          </div>
          <div className="font-semibold text-ink">
            {job.product?.titleRu ?? job.productId.slice(0, 8)}
          </div>
          <div className="text-xs text-muted mt-0.5">
            Style: <span className="font-mono">{job.tyingStyle}</span>
            {job.targetSize && (
              <> · Razmer: <span className="font-mono font-semibold text-oliveDeep">{job.targetSize}</span></>
            )}
            {' '}· Color:{' '}
            <span className="inline-block w-3 h-3 rounded-sm align-middle" style={{ background: job.colorHex }} />{' '}
            <span className="font-mono">{job.colorHex}</span> · Attempts: {job.attempts}
          </div>
        </div>
        <StatusBadge status={job.status} />
      </div>

      <ImageSlot label="Hijob" url={job.hijabUrl} />
      {/* Mannequin reference image was removed from the flow — the GPT
          prompt tells the model to generate a faceless mannequin itself,
          so only the hijab fabric reference is sent. */}

      {!settled && (
        <>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-muted uppercase tracking-wider">
                GPT prompt
              </label>
              <button
                onClick={copyPrompt}
                className="inline-flex items-center gap-1.5 text-xs text-oliveDeep hover:underline"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? 'Nusxalandi' : 'Nusxalash'}
              </button>
            </div>
            <textarea
              readOnly
              value={prompt}
              rows={6}
              className="input font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
            <div className="flex items-center gap-3 mt-2">
              <a
                href="https://chatgpt.com/?model=gpt-4o&hints=search"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-oliveDeep hover:underline"
              >
                <ExternalLink size={12} /> ChatGPT
              </a>
              <a href={job.hijabUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted hover:underline">
                <ExternalLink size={12} /> Hijob rasm
              </a>
            </div>
          </div>

          <div className="pt-3 border-t border-rule space-y-3">
            <div>
              <label className="text-xs font-semibold text-muted uppercase tracking-wider block mb-2">
                Tayyor rasmni yuklash (GPT'dan)
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload(f);
                }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={busy !== null}
                className="btn-primary w-full justify-center"
              >
                {busy === 'upload' ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {busy === 'upload' ? 'Yuklanmoqda…' : 'Rasmni fayl sifatida yuklash'}
              </button>
              <div className="text-[11px] text-muted mt-1.5">
                PNG yoki JPG · bizani serverga saqlanadi · job avto done bo'ladi
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-muted uppercase tracking-wider block mb-2">
                Yoki natija rasm URL
              </label>
              <div className="flex gap-2">
                <input
                  value={resultUrl}
                  onChange={(e) => setResultUrl(e.target.value)}
                  placeholder="https:// …tayyor rasm URL"
                  className="input flex-1 font-mono text-xs"
                />
                <button
                  onClick={complete}
                  disabled={busy !== null || !resultUrl.trim()}
                  className="btn-primary"
                >
                  {busy === 'complete' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  Yuborish
                </button>
              </div>
            </div>

            <details className="group">
              <summary className="text-xs text-muted cursor-pointer hover:text-ink">
                Rad etish
              </summary>
              <div className="flex gap-2 mt-2">
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Sabab (masalan: 'rasm sifatsiz')"
                  className="input flex-1 text-xs"
                />
                <button onClick={fail} disabled={busy !== null} className="btn-danger">
                  {busy === 'fail' ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                  Rad
                </button>
              </div>
            </details>
          </div>
        </>
      )}

      {job.status === 'done' && job.resultUrl && (
        <div className="pt-3 border-t border-rule">
          <div className="text-xs font-semibold text-success uppercase tracking-wider mb-2">
            Tayyor natija
          </div>
          <ImageSlot label="Natija" url={job.resultUrl} tall />
        </div>
      )}
      {job.status === 'failed' && job.errorMessage && (
        <div className="pt-3 border-t border-rule">
          <div className="text-xs font-semibold text-danger uppercase tracking-wider mb-2">
            Xato
          </div>
          <div className="text-xs text-danger bg-danger/10 rounded p-2 font-mono">
            {job.errorMessage}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: StyleJob['status'] }) {
  const config = {
    pending: { label: 'Pending', cls: 'bg-warning/10 text-warning' },
    running: { label: 'Running', cls: 'bg-oliveDeep/10 text-oliveDeep' },
    done: { label: 'Done', cls: 'bg-success/10 text-success' },
    failed: { label: 'Failed', cls: 'bg-danger/10 text-danger' },
  }[status];
  return (
    <span className={`text-xs rounded-pill px-2.5 py-1 font-semibold ${config.cls}`}>
      {config.label}
    </span>
  );
}

function ImageSlot({ label, url, tall }: { label: string; url: string; tall?: boolean }) {
  return (
    <div>
      <div className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-1">
        {label}
      </div>
      <div className={`rounded-lg border border-rule overflow-hidden bg-surface2 ${tall ? 'aspect-[4/5]' : 'aspect-square'}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={label} className="w-full h-full object-cover" />
      </div>
    </div>
  );
}
