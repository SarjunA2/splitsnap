"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  Camera,
  Upload,
  Mic,
  MicOff,
  Loader2,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Receipt,
  ChevronDown,
  ChevronUp,
  Copy,
  Moon,
  Sun,
  Plus,
  X,
  Zap,
  Pencil,
  Trash2,
  Save,
  SlidersHorizontal,
} from "lucide-react";
import type { ReceiptData, LineItem, Person, ItemAssignment, SplitResult } from "./lib/types";
import { calculateSplit } from "./lib/split-calculator";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PERSON_COLORS = [
  "bg-violet-500", "bg-blue-500", "bg-emerald-500", "bg-amber-500",
  "bg-rose-500", "bg-cyan-500", "bg-pink-500", "bg-lime-500",
];
const PERSON_COLORS_TEXT = [
  "text-violet-500", "text-blue-500", "text-emerald-500", "text-amber-500",
  "text-rose-500", "text-cyan-500", "text-pink-500", "text-lime-500",
];

function fmt(n: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
}
function uid() { return Math.random().toString(36).slice(2, 10); }

type Step = "upload" | "people" | "voice" | "results";

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Home() {
  const [dark, setDark] = useState(false);
  const [step, setStep] = useState<Step>("upload");
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [newPersonName, setNewPersonName] = useState("");
  const [assignments, setAssignments] = useState<ItemAssignment[]>([]);
  const [splitResult, setSplitResult] = useState<SplitResult | null>(null);
  const [transcript, setTranscript] = useState("");
  const [voiceNotes, setVoiceNotes] = useState("");
  const [showAssignmentEditor, setShowAssignmentEditor] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  // ── Upload & scan ─────────────────────────────────────────────────────────

  const handleFile = useCallback(async (file: File) => {
    const isHeic =
      file.type === "image/heic" || file.type === "image/heif" ||
      file.name.toLowerCase().endsWith(".heic") || file.name.toLowerCase().endsWith(".heif");

    if (!file.type.startsWith("image/") && !isHeic) {
      setError("Please upload an image file.");
      return;
    }

    setError(null);
    setScanning(true);

    try {
      let uploadFile = file;
      if (isHeic) {
        try {
          const heic2any = (await import("heic2any")).default;
          const result = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.85 });
          const blob = Array.isArray(result) ? result[0] : result;
          uploadFile = new File(
            [blob],
            file.name.replace(/\.heic$/i, ".jpg").replace(/\.heif$/i, ".jpg"),
            { type: "image/jpeg" }
          );
        } catch (convErr) {
          console.warn("[heic2any] conversion failed, server will handle:", convErr);
        }
      }

      const reader = new FileReader();
      reader.onload = (e) => setImagePreview(e.target?.result as string);
      reader.readAsDataURL(uploadFile);

      const fd = new FormData();
      fd.append("image", uploadFile);
      const res = await fetch("/api/scan-receipt", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json()).error ?? "Scan failed");
      const data: ReceiptData = await res.json();
      setReceipt(data);
      setStep("people");
    } catch (e) {
      setError(String(e));
    } finally {
      setScanning(false);
    }
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  };
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  // ── People ────────────────────────────────────────────────────────────────

  const addPerson = () => {
    const name = newPersonName.trim();
    if (!name) return;
    const colorIndex = people.length % PERSON_COLORS.length;
    setPeople((p) => [...p, { id: `person_${uid()}`, name, color: PERSON_COLORS[colorIndex] }]);
    setNewPersonName("");
  };
  const removePerson = (id: string) => setPeople((p) => p.filter((x) => x.id !== id));

  // ── Voice ─────────────────────────────────────────────────────────────────

  const startRecording = () => {
    const SR =
      (typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition));

    if (!SR) {
      setError("Voice recognition not supported. Use Chrome or Edge, or type below.");
      return;
    }
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    let finalTranscript = "";
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalTranscript += t + " ";
        else interim += t;
      }
      setTranscript(finalTranscript + interim);
    };
    recognition.onerror = (e: SpeechRecognitionErrorEvent) => {
      setError(`Voice error: ${e.error}`);
      setRecording(false);
    };
    recognition.onend = () => setRecording(false);
    recognitionRef.current = recognition;
    recognition.start();
    setRecording(true);
    setTranscript("");
  };
  const stopRecording = () => { recognitionRef.current?.stop(); setRecording(false); };

  // ── Parse voice → assignments ─────────────────────────────────────────────

  const parseSplit = async () => {
    const text = transcript.trim() || voiceNotes.trim();
    if (!text || !receipt || !people.length) return;

    setParsing(true);
    setError(null);
    try {
      const res = await fetch("/api/parse-split", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: text, items: receipt.items, people }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Parse failed");
      const data = await res.json();
      setAssignments(data.assignments ?? []);
      // Show editor so user can verify/fix before calculating
      setShowAssignmentEditor(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setParsing(false);
    }
  };

  // ── Calculate split from current assignments ───────────────────────────────

  const calculateAndGoToResults = (currentAssignments: ItemAssignment[]) => {
    if (!receipt || !people.length) return;
    const result = calculateSplit(receipt, people, currentAssignments);
    setAssignments(currentAssignments);
    setSplitResult(result);
    setShowAssignmentEditor(false);
    setStep("results");
  };

  // ── Copy summary ──────────────────────────────────────────────────────────

  const copySummary = () => {
    if (!splitResult || !receipt) return;
    const lines = [
      `🧾 ${receipt.restaurantName ?? "Receipt"} — ${fmt(receipt.total, receipt.currency)}`,
      "",
      ...splitResult.splits.map(
        (s) => `${s.personName}: ${fmt(s.total, receipt.currency)} (${s.items.map((i) => i.name).join(", ")})`
      ),
      "",
      `Tax: ${fmt(receipt.tax, receipt.currency)} | Tip: ${fmt(receipt.tip, receipt.currency)}`,
    ];
    navigator.clipboard.writeText(lines.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const reset = () => {
    setStep("upload"); setReceipt(null); setImagePreview(null);
    setPeople([]); setAssignments([]); setSplitResult(null);
    setTranscript(""); setVoiceNotes(""); setError(null);
    setShowAssignmentEditor(false);
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white/80 dark:bg-zinc-950/80 backdrop-blur border-b border-gray-200 dark:border-zinc-800">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-emerald-500" />
            <span className="font-bold text-lg tracking-tight">SplitSnap</span>
          </div>
          <div className="flex items-center gap-2">
            {step !== "upload" && (
              <button onClick={reset} className="text-sm flex items-center gap-1 text-gray-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white transition-colors">
                <RotateCcw className="w-3.5 h-3.5" /> Start over
              </button>
            )}
            <button onClick={() => setDark((d) => !d)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors">
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* Step indicator */}
      <div className="bg-white dark:bg-zinc-950 border-b border-gray-200 dark:border-zinc-800">
        <div className="max-w-lg mx-auto px-4 py-2 flex gap-1">
          {(["upload", "people", "voice", "results"] as Step[]).map((s, i) => {
            const labels = ["Scan", "People", "Voice", "Results"];
            const isCurrent = step === s;
            const isPast =
              (s === "upload" && ["people", "voice", "results"].includes(step)) ||
              (s === "people" && ["voice", "results"].includes(step)) ||
              (s === "voice" && step === "results");
            return (
              <div key={s} className="flex items-center gap-1 flex-1">
                <div className={`flex-1 flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-all
                  ${isCurrent ? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400" : ""}
                  ${isPast ? "text-gray-500 dark:text-zinc-500" : ""}
                  ${!isCurrent && !isPast ? "text-gray-300 dark:text-zinc-700" : ""}`}>
                  <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold
                    ${isCurrent ? "bg-emerald-500 text-white" : ""}
                    ${isPast ? "bg-gray-200 dark:bg-zinc-700 text-gray-500 dark:text-zinc-400" : ""}
                    ${!isCurrent && !isPast ? "bg-gray-100 dark:bg-zinc-800 text-gray-300 dark:text-zinc-700" : ""}`}>
                    {i + 1}
                  </span>
                  {labels[i]}
                </div>
                {i < 3 && <div className="w-2 h-px bg-gray-200 dark:bg-zinc-800" />}
              </div>
            );
          })}
        </div>
      </div>

      {/* Main */}
      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-6 space-y-4">

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-3 flex items-start gap-2">
            <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* ── STEP 1: Upload ── */}
        {step === "upload" && (
          <div className="space-y-4">
            <div>
              <h1 className="text-2xl font-bold">Scan a receipt</h1>
              <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1">Take a photo or upload — AI extracts all items automatically.</p>
            </div>
            {scanning ? (
              <div className="border-2 border-dashed border-emerald-300 dark:border-emerald-700 rounded-2xl p-12 flex flex-col items-center gap-3">
                <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
                <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">Scanning receipt...</p>
                {imagePreview && <img src={imagePreview} alt="Receipt" className="w-24 h-24 object-cover rounded-lg opacity-50" />}
              </div>
            ) : (
              <div
                onDrop={onDrop} onDragOver={(e) => e.preventDefault()}
                className="border-2 border-dashed border-gray-200 dark:border-zinc-700 rounded-2xl p-8 flex flex-col items-center gap-4 hover:border-emerald-300 dark:hover:border-emerald-700 transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="w-16 h-16 bg-emerald-50 dark:bg-emerald-900/30 rounded-2xl flex items-center justify-center">
                  <Receipt className="w-8 h-8 text-emerald-500" />
                </div>
                <div className="text-center">
                  <p className="font-medium">Drop your receipt here</p>
                  <p className="text-sm text-gray-500 dark:text-zinc-400">or tap to choose a file</p>
                </div>
                <div className="flex gap-3 w-full">
                  <button
                    onClick={(e) => { e.stopPropagation(); cameraInputRef.current?.click(); }}
                    className="flex-1 flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white font-medium py-3 px-4 rounded-xl transition-colors text-sm"
                    title="Use camera (mobile only)"
                  >
                    <Camera className="w-4 h-4" /> Camera <span className="opacity-60 text-xs">(mobile)</span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                    className="flex-1 flex items-center justify-center gap-2 bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 font-medium py-3 px-4 rounded-xl transition-colors text-sm"
                  >
                    <Upload className="w-4 h-4" /> Upload
                  </button>
                </div>
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFileChange} />
            <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFileChange} />
          </div>
        )}

        {/* ── STEP 2: People ── */}
        {step === "people" && receipt && (
          <div className="space-y-4">
            <div>
              <h2 className="text-2xl font-bold">Who&apos;s splitting?</h2>
              <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1">Add everyone at the table.</p>
            </div>

            <ReceiptCard
              receipt={receipt}
              imagePreview={imagePreview}
              onUpdate={(updated) => setReceipt(updated)}
            />

            <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-4 space-y-3">
              <div className="flex gap-2">
                <input
                  type="text" value={newPersonName}
                  onChange={(e) => setNewPersonName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addPerson()}
                  placeholder="Name..."
                  className="flex-1 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                />
                <button onClick={addPerson} disabled={!newPersonName.trim()}
                  className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-white px-3 py-2.5 rounded-xl transition-colors">
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              {people.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {people.map((p) => (
                    <div key={p.id} className="flex items-center gap-1.5 bg-gray-100 dark:bg-zinc-800 rounded-full pl-2 pr-1 py-1">
                      <div className={`w-5 h-5 rounded-full ${p.color} flex items-center justify-center text-white text-[10px] font-bold`}>
                        {p.name[0].toUpperCase()}
                      </div>
                      <span className="text-sm font-medium">{p.name}</span>
                      <button onClick={() => removePerson(p.id)} className="p-0.5 hover:bg-gray-200 dark:hover:bg-zinc-700 rounded-full transition-colors">
                        <X className="w-3 h-3 text-gray-500" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button onClick={() => setStep("voice")} disabled={people.length < 2}
              className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2">
              <Mic className="w-4 h-4" /> Continue to voice split
            </button>
            {people.length < 2 && <p className="text-center text-xs text-gray-400 dark:text-zinc-600">Add at least 2 people</p>}
          </div>
        )}

        {/* ── STEP 3: Voice ── */}
        {step === "voice" && receipt && (
          <div className="space-y-4">
            {!showAssignmentEditor ? (
              <>
                <div>
                  <h2 className="text-2xl font-bold">Who got what?</h2>
                  <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1">Record a voice message or type it — speak naturally.</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {people.map((p) => (
                    <div key={p.id} className="flex items-center gap-1.5 bg-gray-100 dark:bg-zinc-800 rounded-full px-2.5 py-1">
                      <div className={`w-4 h-4 rounded-full ${p.color}`} />
                      <span className="text-sm font-medium">{p.name}</span>
                    </div>
                  ))}
                </div>

                <details className="group bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl">
                  <summary className="flex items-center justify-between p-4 cursor-pointer select-none">
                    <span className="font-medium text-sm">{receipt.items.length} items on receipt</span>
                    <ChevronDown className="w-4 h-4 text-gray-400 group-open:rotate-180 transition-transform" />
                  </summary>
                  <div className="px-4 pb-4 space-y-1.5">
                    {receipt.items.map((item) => (
                      <div key={item.id} className="flex justify-between text-sm">
                        <span className="text-gray-700 dark:text-zinc-300">
                          {item.quantity > 1 && <span className="text-gray-400 mr-1">{item.quantity}×</span>}
                          {item.name}
                        </span>
                        <span className="font-medium">{fmt(item.price * item.quantity, receipt.currency)}</span>
                      </div>
                    ))}
                  </div>
                </details>

                <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-5 space-y-4">
                  <div className="flex flex-col items-center gap-3">
                    <button
                      onClick={recording ? stopRecording : startRecording}
                      className={`w-20 h-20 rounded-full flex items-center justify-center transition-all shadow-lg
                        ${recording ? "bg-red-500 hover:bg-red-600 animate-pulse-slow scale-110" : "bg-emerald-500 hover:bg-emerald-600"}`}
                    >
                      {recording ? <MicOff className="w-8 h-8 text-white" /> : <Mic className="w-8 h-8 text-white" />}
                    </button>
                    <p className="text-sm text-gray-500 dark:text-zinc-400">{recording ? "Listening… tap to stop" : "Tap to record"}</p>
                  </div>

                  {transcript && (
                    <div className="bg-gray-50 dark:bg-zinc-800 rounded-xl p-3 text-sm text-gray-700 dark:text-zinc-300 italic">
                      &ldquo;{transcript}&rdquo;
                    </div>
                  )}

                  <div className="relative">
                    <div className="absolute inset-x-0 -top-2.5 flex justify-center">
                      <span className="bg-white dark:bg-zinc-900 px-2 text-xs text-gray-400 dark:text-zinc-600">or type it</span>
                    </div>
                    <div className="border border-gray-200 dark:border-zinc-700 rounded-xl p-3">
                      <textarea
                        value={voiceNotes} onChange={(e) => setVoiceNotes(e.target.value)}
                        placeholder={`e.g. "John had the burger and fries, Sarah had the salad, we all split the appetizer"`}
                        rows={3}
                        className="w-full bg-transparent text-sm resize-none focus:outline-none placeholder-gray-400 dark:placeholder-zinc-600"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={parseSplit}
                    disabled={(!transcript.trim() && !voiceNotes.trim()) || parsing}
                    className="flex-1 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2"
                  >
                    {parsing ? <><Loader2 className="w-4 h-4 animate-spin" /> Splitting...</> : <><Zap className="w-4 h-4" /> Split the bill</>}
                  </button>
                  <button
                    onClick={() => { setAssignments([]); setShowAssignmentEditor(true); }}
                    className="border border-gray-200 dark:border-zinc-800 text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-zinc-900 font-medium py-3.5 px-4 rounded-xl transition-colors flex items-center gap-2 text-sm"
                    title="Assign items manually"
                  >
                    <SlidersHorizontal className="w-4 h-4" /> Manual
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-bold">Review assignments</h2>
                    <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1">Tap people to toggle who gets each item.</p>
                  </div>
                  <button
                    onClick={() => setShowAssignmentEditor(false)}
                    className="text-sm text-gray-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white flex items-center gap-1"
                  >
                    <Mic className="w-3.5 h-3.5" /> Voice
                  </button>
                </div>
                <AssignmentEditor
                  receipt={receipt}
                  people={people}
                  initialAssignments={assignments}
                  onConfirm={calculateAndGoToResults}
                />
              </>
            )}
          </div>
        )}

        {/* ── STEP 4: Results ── */}
        {step === "results" && splitResult && receipt && (
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-2xl font-bold">Here&apos;s the split</h2>
                <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1">Tax distributed proportionally.</p>
              </div>
              <button onClick={copySummary} className="flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 transition-colors">
                {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>

            {/* Receipt total banner */}
            <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-4 flex justify-between items-center">
              <div>
                <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{receipt.restaurantName ?? "Receipt total"}</p>
                <p className="text-xs text-emerald-600 dark:text-emerald-500 mt-0.5">
                  Subtotal {fmt(receipt.subtotal, receipt.currency)} + Tax {fmt(receipt.tax, receipt.currency)}
                  {receipt.tip > 0 && ` + Tip ${fmt(receipt.tip, receipt.currency)}`}
                </p>
              </div>
              <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{fmt(receipt.total, receipt.currency)}</p>
            </div>

            {/* Per-person cards */}
            <div className="space-y-3">
              {splitResult.splits.map((s, i) => {
                const colorText = PERSON_COLORS_TEXT[i % PERSON_COLORS_TEXT.length];
                const colorBg = PERSON_COLORS[i % PERSON_COLORS.length];
                return (
                  <details key={s.personId} className="group bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl">
                    <summary className="flex items-center gap-3 p-4 cursor-pointer select-none list-none">
                      <div className={`w-9 h-9 rounded-full ${colorBg} flex items-center justify-center text-white font-bold text-sm shrink-0`}>
                        {s.personName[0].toUpperCase()}
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold">{s.personName}</p>
                        <p className="text-xs text-gray-500 dark:text-zinc-500">{s.items.length} item{s.items.length !== 1 ? "s" : ""}</p>
                      </div>
                      <div className="text-right">
                        <p className={`text-xl font-bold ${colorText}`}>{fmt(s.total, receipt.currency)}</p>
                        <ChevronDown className="w-4 h-4 text-gray-400 group-open:rotate-180 transition-transform ml-auto mt-0.5" />
                      </div>
                    </summary>
                    <div className="px-4 pb-4 space-y-2 border-t border-gray-100 dark:border-zinc-800 pt-3">
                      {s.items.map((item, j) => (
                        <div key={j} className="flex justify-between text-sm">
                          <span className="text-gray-600 dark:text-zinc-400">{item.name}</span>
                          <span>{fmt(item.share, receipt.currency)}</span>
                        </div>
                      ))}
                      {s.items.length === 0 && <p className="text-sm text-gray-400 dark:text-zinc-600 italic">No items assigned</p>}
                      <div className="border-t border-gray-100 dark:border-zinc-800 pt-2 space-y-1">
                        <div className="flex justify-between text-xs text-gray-500 dark:text-zinc-500">
                          <span>Tax share</span><span>+{fmt(s.taxShare, receipt.currency)}</span>
                        </div>
                        {s.tipShare > 0 && (
                          <div className="flex justify-between text-xs text-gray-500 dark:text-zinc-500">
                            <span>Tip share</span><span>+{fmt(s.tipShare, receipt.currency)}</span>
                          </div>
                        )}
                        <div className={`flex justify-between text-sm font-bold ${colorText} pt-1`}>
                          <span>Total</span><span>{fmt(s.total, receipt.currency)}</span>
                        </div>
                      </div>
                    </div>
                  </details>
                );
              })}
            </div>

            {/* Edit actions */}
            <div className="flex gap-3">
              <button
                onClick={() => { setShowAssignmentEditor(true); setStep("voice"); }}
                className="flex-1 border border-gray-200 dark:border-zinc-800 text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-zinc-900 font-medium py-3 px-4 rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
              >
                <SlidersHorizontal className="w-4 h-4" /> Edit assignments
              </button>
              <button
                onClick={() => { setShowAssignmentEditor(false); setStep("voice"); }}
                className="flex-1 border border-gray-200 dark:border-zinc-800 text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-zinc-900 font-medium py-3 px-4 rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
              >
                <Mic className="w-4 h-4" /> Re-record
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ─── ReceiptCard (with edit mode) ─────────────────────────────────────────────

function ReceiptCard({
  receipt,
  imagePreview,
  onUpdate,
}: {
  receipt: ReceiptData;
  imagePreview: string | null;
  onUpdate: (updated: ReceiptData) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ReceiptData>(receipt);

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(JSON.parse(JSON.stringify(receipt))); // deep clone
    setEditing(true);
    setOpen(true);
  };

  const saveEdit = () => {
    // Recalculate subtotal from items
    const subtotal = draft.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const updated = { ...draft, subtotal, total: subtotal + draft.tax + draft.tip };
    onUpdate(updated);
    setEditing(false);
  };

  const cancelEdit = () => { setEditing(false); setDraft(receipt); };

  const updateItem = (id: string, field: keyof LineItem, value: string) => {
    setDraft((d) => ({
      ...d,
      items: d.items.map((item) =>
        item.id === id
          ? { ...item, [field]: field === "name" ? value : parseFloat(value) || 0 }
          : item
      ),
    }));
  };

  const addItem = () => {
    const newId = `item_${uid()}`;
    setDraft((d) => ({
      ...d,
      items: [...d.items, { id: newId, name: "New item", price: 0, quantity: 1 }],
    }));
  };

  const removeItem = (id: string) => {
    setDraft((d) => ({ ...d, items: d.items.filter((i) => i.id !== id) }));
  };

  const r = editing ? draft : receipt;

  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-3 p-4">
        <button onClick={() => !editing && setOpen((o) => !o)} className="flex items-center gap-3 flex-1 text-left">
          {imagePreview && <img src={imagePreview} alt="Receipt" className="w-12 h-12 object-cover rounded-lg shrink-0" />}
          <div className="flex-1 min-w-0">
            {editing ? (
              <input
                value={draft.restaurantName ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, restaurantName: e.target.value }))}
                placeholder="Restaurant name"
                className="w-full text-sm font-semibold bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <p className="font-semibold text-sm truncate">{receipt.restaurantName ?? "Receipt scanned"}</p>
            )}
            <p className="text-xs text-gray-500 dark:text-zinc-500 mt-0.5">
              {r.items.length} items · Total {fmt(r.total, r.currency)}
            </p>
          </div>
        </button>
        <div className="flex items-center gap-1 shrink-0">
          {editing ? (
            <>
              <button onClick={cancelEdit} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800 text-gray-500 transition-colors">
                <X className="w-4 h-4" />
              </button>
              <button onClick={saveEdit} className="p-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white transition-colors">
                <Save className="w-4 h-4" />
              </button>
            </>
          ) : (
            <>
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              <button onClick={startEdit} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800 text-gray-500 transition-colors" title="Edit receipt">
                <Pencil className="w-4 h-4" />
              </button>
              <button onClick={() => setOpen((o) => !o)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800 text-gray-400 transition-colors">
                {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Expanded body */}
      {open && (
        <div className="border-t border-gray-100 dark:border-zinc-800 px-4 pb-4 pt-3 space-y-2">
          {r.items.map((item) => (
            editing ? (
              <div key={item.id} className="flex items-center gap-2">
                <input
                  value={item.name}
                  onChange={(e) => updateItem(item.id, "name", e.target.value)}
                  className="flex-1 text-sm bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="Item name"
                />
                <input
                  type="number" min="1" step="1"
                  value={item.quantity}
                  onChange={(e) => updateItem(item.id, "quantity", e.target.value)}
                  className="w-12 text-sm text-center bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg px-1 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  title="Qty"
                />
                <input
                  type="number" min="0" step="0.01"
                  value={item.price}
                  onChange={(e) => updateItem(item.id, "price", e.target.value)}
                  className="w-20 text-sm text-right bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  title="Unit price"
                />
                <button onClick={() => removeItem(item.id)} className="p-1 text-red-400 hover:text-red-600 transition-colors shrink-0">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div key={item.id} className="flex justify-between text-sm">
                <span className="text-gray-700 dark:text-zinc-300">
                  {item.quantity > 1 && <span className="text-gray-400 mr-1">{item.quantity}×</span>}
                  {item.name}
                </span>
                <span className="font-medium">{fmt(item.price * item.quantity, r.currency)}</span>
              </div>
            )
          ))}

          {editing && (
            <button onClick={addItem} className="w-full flex items-center justify-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400 border border-dashed border-emerald-300 dark:border-emerald-700 rounded-xl py-2 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
              <Plus className="w-4 h-4" /> Add item
            </button>
          )}

          <div className="border-t border-gray-100 dark:border-zinc-800 pt-2 space-y-1.5">
            {editing ? (
              <>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-gray-500 dark:text-zinc-500 shrink-0">Tax</span>
                  <input
                    type="number" min="0" step="0.01" value={draft.tax}
                    onChange={(e) => setDraft((d) => ({ ...d, tax: parseFloat(e.target.value) || 0 }))}
                    className="w-24 text-sm text-right bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-gray-500 dark:text-zinc-500 shrink-0">Tip</span>
                  <input
                    type="number" min="0" step="0.01" value={draft.tip}
                    onChange={(e) => setDraft((d) => ({ ...d, tip: parseFloat(e.target.value) || 0 }))}
                    className="w-24 text-sm text-right bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-between text-sm text-gray-500 dark:text-zinc-500">
                  <span>Tax</span><span>{fmt(r.tax, r.currency)}</span>
                </div>
                {r.tip > 0 && (
                  <div className="flex justify-between text-sm text-gray-500 dark:text-zinc-500">
                    <span>Tip</span><span>{fmt(r.tip, r.currency)}</span>
                  </div>
                )}
              </>
            )}
          </div>

          {editing && (
            <p className="text-xs text-gray-400 dark:text-zinc-600 text-center pt-1">
              Subtotal auto-calculated · hit Save when done
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── AssignmentEditor ─────────────────────────────────────────────────────────

function AssignmentEditor({
  receipt,
  people,
  initialAssignments,
  onConfirm,
}: {
  receipt: ReceiptData;
  people: Person[];
  initialAssignments: ItemAssignment[];
  onConfirm: (assignments: ItemAssignment[]) => void;
}) {
  // Build a local map: itemId → Set of personIds
  const [assignMap, setAssignMap] = useState<Map<string, Set<string>>>(() => {
    const map = new Map<string, Set<string>>();
    for (const item of receipt.items) {
      const existing = initialAssignments.find((a) => a.itemId === item.id);
      map.set(item.id, new Set(existing?.personIds ?? []));
    }
    return map;
  });

  const toggle = (itemId: string, personId: string) => {
    setAssignMap((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(itemId) ?? []);
      if (set.has(personId)) set.delete(personId);
      else set.add(personId);
      next.set(itemId, set);
      return next;
    });
  };

  const assignAll = (itemId: string) => {
    setAssignMap((prev) => {
      const next = new Map(prev);
      next.set(itemId, new Set(people.map((p) => p.id)));
      return next;
    });
  };

  const handleConfirm = () => {
    const assignments: ItemAssignment[] = Array.from(assignMap.entries())
      .filter(([, personSet]) => personSet.size > 0)
      .map(([itemId, personSet]) => ({ itemId, personIds: Array.from(personSet) }));
    onConfirm(assignments);
  };

  const unassignedCount = Array.from(assignMap.values()).filter((s) => s.size === 0).length;

  return (
    <div className="space-y-3">
      {receipt.items.map((item, idx) => {
        const assigned = assignMap.get(item.id) ?? new Set<string>();
        const isUnassigned = assigned.size === 0;

        return (
          <div
            key={item.id}
            className={`bg-white dark:bg-zinc-900 border rounded-2xl p-4 space-y-3 transition-colors
              ${isUnassigned ? "border-amber-200 dark:border-amber-800" : "border-gray-200 dark:border-zinc-800"}`}
          >
            {/* Item header */}
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium text-sm">
                  {item.quantity > 1 && <span className="text-gray-400 mr-1">{item.quantity}×</span>}
                  {item.name}
                </p>
                <p className="text-xs text-gray-500 dark:text-zinc-500 mt-0.5">
                  {fmt(item.price * item.quantity, receipt.currency)}
                  {assigned.size > 1 && ` ÷ ${assigned.size} = ${fmt((item.price * item.quantity) / assigned.size, receipt.currency)} each`}
                </p>
              </div>
              {isUnassigned && (
                <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-2 py-0.5 rounded-full shrink-0">
                  Unassigned
                </span>
              )}
            </div>

            {/* Person toggles */}
            <div className="flex flex-wrap gap-2">
              {people.map((p, pi) => {
                const isOn = assigned.has(p.id);
                const colorBg = PERSON_COLORS[pi % PERSON_COLORS.length];
                return (
                  <button
                    key={p.id}
                    onClick={() => toggle(item.id, p.id)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-sm font-medium transition-all border
                      ${isOn
                        ? `${colorBg} text-white border-transparent shadow-sm`
                        : "bg-gray-50 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400 border-gray-200 dark:border-zinc-700"
                      }`}
                  >
                    <span>{p.name}</span>
                    {isOn && <CheckCircle2 className="w-3.5 h-3.5 opacity-80" />}
                  </button>
                );
              })}
              <button
                onClick={() => assignAll(item.id)}
                className="px-2.5 py-1.5 rounded-full text-xs text-gray-400 dark:text-zinc-600 border border-dashed border-gray-200 dark:border-zinc-700 hover:border-gray-400 hover:text-gray-600 transition-colors"
              >
                All
              </button>
            </div>
          </div>
        );
      })}

      {unassignedCount > 0 && (
        <p className="text-center text-xs text-amber-600 dark:text-amber-400">
          {unassignedCount} item{unassignedCount !== 1 ? "s" : ""} still unassigned — they'll be excluded from the split
        </p>
      )}

      <button
        onClick={handleConfirm}
        className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-semibold py-3.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2"
      >
        <Zap className="w-4 h-4" /> Calculate split
      </button>
    </div>
  );
}
