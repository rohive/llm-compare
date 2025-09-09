import React, { useEffect, useMemo, useState, useRef } from "react";
import axios from "axios";

/**
 * Frontend App (collapsed Available models, top-5 per provider, "Show all" toggles)
 */

function ModelPill({ model, selected, disabled, onToggle }) {
  return (
    <button
      onClick={() => !disabled && onToggle(model.id)}
      className={`px-3 py-1 rounded-full mr-2 mb-2 text-sm font-medium transition-all ${
        selected ? "ring-2 ring-offset-1 bg-gradient-to-r from-mint-100 to-violet-100" : "border hover:shadow-sm"
      } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
      title={`${model.provider}:${model.engine}`}
    >
      <div className="flex items-center gap-2">
        <span className="font-semibold truncate max-w-[10rem]">{model.displayName}</span>
        <span className="text-xs opacity-60">{model.provider}</span>
      </div>
    </button>
  );
}

function ResponseCard({ r, liked, onLike, recommended }) {
  return (
    <div className={`p-4 rounded-2xl shadow-md border bg-white ${recommended ? "ring-4 ring-indigo-200" : ""}`}>
      <div className="flex justify-between items-start">
        <div>
          <div className="text-sm font-semibold">{r.modelDisplay}</div>
          <div className="text-xs opacity-70">{r.modelId}</div>
        </div>
        <div className="flex items-center gap-3">
          {r.metrics ? (
            <>
              <div className="text-xs opacity-70">{r.metrics.timeMs} ms</div>
              <div className="text-xs opacity-70">{r.metrics.length} chars</div>
            </>
          ) : (
            <div className="text-xs opacity-70">—</div>
          )}
          <button
            onClick={() => onLike(r.modelId)}
            className={`px-3 py-1 rounded-full border text-sm ${liked ? "bg-green-100" : ""}`}
          >
            {liked ? "Liked" : "Like"}
          </button>
        </div>
      </div>

      <div className="mt-3 text-sm whitespace-pre-wrap min-h-[80px]">
        {r.error ? <span className="text-red-600">{r.message || r.error}</span> : r.text}
      </div>
    </div>
  );
}

// SSE-like stream parser for POST fetch streams
async function streamCompareFetch(url, bodyObj, onEvent) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bodyObj),
  });
  if (!resp.body) throw new Error("No response body stream available");
  const reader = resp.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let parts = buf.split("\n\n");
    buf = parts.pop();
    for (const p of parts) {
      const lines = p.split("\n").map(l => l.trim()).filter(Boolean);
      let ev = null;
      let dataLines = [];
      for (const line of lines) {
        if (line.startsWith("event:")) ev = line.replace(/^event:\s*/, "").trim();
        else if (line.startsWith("data:")) dataLines.push(line.replace(/^data:\s*/, ""));
      }
      if (!ev) continue;
      const joined = dataLines.join("\n");
      let parsed = null;
      try { parsed = JSON.parse(joined); } catch { parsed = joined; }
      try { onEvent(ev, parsed); } catch (err) { console.warn("onEvent handler error", err); }
    }
  }

  if (buf.trim()) {
    const p = buf.trim();
    const lines = p.split("\n").map(l => l.trim()).filter(Boolean);
    let ev = null;
    let dataLines = [];
    for (const line of lines) {
      if (line.startsWith("event:")) ev = line.replace(/^event:\s*/, "").trim();
      else if (line.startsWith("data:")) dataLines.push(line.replace(/^data:\s*/, ""));
    }
    if (ev) {
      let parsed = null;
      try { parsed = JSON.parse(dataLines.join("\n")); } catch { parsed = dataLines.join("\n"); }
      onEvent(ev, parsed);
    }
  }
}

// Main App
export default function App() {
  const [query, setQuery] = useState("");
  const [models, setModels] = useState({ openai: [], anthropics: [] });
  const [selected, setSelected] = useState([]);
  const [responses, setResponses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [likedModelId, setLikedModelId] = useState(null);
  const [streaming, setStreaming] = useState(false);
  const [modelsCollapsed, setModelsCollapsed] = useState(true); // collapsed by default
  const [showAllOpenAI, setShowAllOpenAI] = useState(false);
  const [showAllAnthropic, setShowAllAnthropic] = useState(false);
  const streamControllersRef = useRef({});

  useEffect(() => {
    let cancelled = false;
    (async function load() {
      try {
        const r = await axios.get("/api/models");
        if (cancelled) return;
        const data = r.data;
        if (Array.isArray(data)) {
          setModels({ openai: data, anthropics: [] });
          const gpt = data.find(m => m.provider === "openai" && /gpt/i.test(m.engine));
          const cla = data.find(m => m.provider === "anthropic");
          setSelected([gpt?.id, cla?.id].filter(Boolean).slice(0, 3));
        } else if (data && typeof data === "object") {
          const open = Array.isArray(data.openai) ? data.openai : [];
          const anth = Array.isArray(data.anthropics) ? data.anthropics : [];
          setModels({ openai: open, anthropics: anth });
          const gpt = open.find(m => /gpt/i.test(m.engine));
          const cla = anth[0];
          setSelected([gpt?.id, cla?.id].filter(Boolean).slice(0, 3));
        } else {
          setModels({ openai: [], anthropics: [] });
        }
      } catch (err) {
        console.error("Failed loading models", err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const toggleModel = (id) => {
    setSelected(prev => {
      if (prev.includes(id)) return prev.filter(p => p !== id);
      if (prev.length >= 3) return prev;
      return [...prev, id];
    });
  };

  const onLike = async (modelId) => {
    setLikedModelId(prev => prev === modelId ? null : modelId);
    try { await axios.post("/api/likes", { query, modelId }); } catch {}
  };

  const recommendedId = useMemo(() => {
    if (likedModelId) return likedModelId;
    if (!responses.length) return null;
    const valid = responses.filter(r => !r.error && r.metrics);
    if (!valid.length) return responses[0]?.modelId ?? null;
    const maxL = Math.max(...valid.map(r => r.metrics.length));
    const minT = Math.min(...valid.map(r => r.metrics.timeMs));
    let best = valid[0];
    let bestScore = -Infinity;
    for (const r of valid) {
      const ls = r.metrics.length / (maxL || 1);
      const ts = minT / (r.metrics.timeMs || 1);
      const score = 0.6 * ls + 0.4 * ts;
      if (score > bestScore) { bestScore = score; best = r; }
    }
    return best.modelId;
  }, [responses, likedModelId]);

  const compare = async () => {
    if (!query.trim()) return;
    if (!selected.length) return alert("Select at least one model");
    setLoading(true);
    setResponses([]);
    setLikedModelId(null);
    try {
      const { data } = await axios.post("/api/compare", { query, modelIds: selected });
      const res = (data.responses || []).map(r => ({
        modelId: r.modelId,
        modelDisplay: r.modelDisplay,
        text: r.text ?? "",
        metrics: r.metrics ?? null,
        error: r.error ?? false,
        message: r.message ?? (r.error ? "Error" : undefined)
      }));
      setResponses(res);
    } catch (err) {
      console.error("Compare failed", err);
      alert("Compare failed: " + (err.message || "unknown"));
    } finally {
      setLoading(false);
    }
  };

  const compareStream = async () => {
    if (!query.trim()) return;
    if (!selected.length) return alert("Select at least one model");
    setStreaming(true);
    setResponses([]);
    setLikedModelId(null);
    streamControllersRef.current = {};

    const initial = selected.map(id => ({ modelId: id, modelDisplay: id, text: "", metrics: null, error: false }));
    setResponses(initial);

    const onEvent = (ev, payload) => {
      if (ev === "model-start") {
        const { modelId, modelDisplay } = payload || {};
        setResponses(prev => prev.map(r => r.modelId === modelId ? { ...r, modelDisplay: modelDisplay ?? r.modelDisplay } : r));
        streamControllersRef.current[modelId] = { buffer: "" };
      } else if (ev === "model-chunk") {
        const { modelId, text } = payload || {};
        if (!modelId) return;
        streamControllersRef.current[modelId] = streamControllersRef.current[modelId] || { buffer: "" };
        streamControllersRef.current[modelId].buffer += text ?? "";
        setResponses(prev => prev.map(r => r.modelId === modelId ? { ...r, text: streamControllersRef.current[modelId].buffer } : r));
      } else if (ev === "model-end") {
        const { modelId, metrics } = payload || {};
        if (modelId && metrics) {
          setResponses(prev => prev.map(r => r.modelId === modelId ? { ...r, metrics: metrics } : r));
        }
      } else if (ev === "model-error") {
        const { modelId, message } = payload || {};
        setResponses(prev => prev.map(r => r.modelId === modelId ? { ...r, error: true, message: message || "Error" } : r));
      } else if (ev === "model-skipped") {
        const { modelId, reason } = payload || {};
        setResponses(prev => prev.map(r => r.modelId === modelId ? { ...r, error: true, message: `Skipped: ${reason}` } : r));
      } else if (ev === "done") {
        setStreaming(false);
      }
    };

    try {
      await streamCompareFetch("/api/stream", { query, modelIds: selected }, onEvent);
    } catch (err) {
      console.error("Stream failed", err);
      alert("Stream failed: " + (err.message || err));
      setStreaming(false);
    }
  };

  const openAIModels = Array.isArray(models.openai) ? models.openai : [];
  const anthropicModels = Array.isArray(models.anthropics) ? models.anthropics : [];

  const topN = (arr, n = 5) => arr.slice(0, n);

  const displayedOpenAI = showAllOpenAI ? openAIModels : topN(openAIModels, 5);
  const displayedAnthropic = showAllAnthropic ? anthropicModels : topN(anthropicModels, 5);

  return (
    <div className="min-h-screen flex items-start justify-center p-8" style={{ background: "linear-gradient(180deg,#FFFBEB,#F0F9FF)" }}>
      <div className="w-full max-w-6xl">
        <header className="mb-6">
          <h1 className="text-3xl font-extrabold mb-1">LLM Compare</h1>
          <p className="text-sm opacity-70">Choose up to 3 models, compare responses, or stream live.</p>
        </header>

        <main className="space-y-6">
          <div className="bg-white p-6 rounded-2xl shadow-lg border">
            <div className="flex gap-4 items-start">
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ask something..."
                className="flex-1 p-4 rounded-xl border resize-none h-28"
              />
              <div className="w-44 flex flex-col gap-3">
                <div className="text-sm opacity-70">Selected: {selected.length}/3</div>
                <button
                  onClick={compare}
                  disabled={loading || selected.length === 0 || streaming}
                  className="px-4 py-2 rounded-xl font-semibold shadow-md"
                  style={{ background: "linear-gradient(90deg,#60A5FA,#A78BFA)", color: "white" }}
                >
                  {loading ? "Comparing..." : "Compare"}
                </button>
                <button
                  onClick={compareStream}
                  disabled={streaming || selected.length === 0 || loading}
                  className="px-4 py-2 rounded-xl font-semibold shadow-md"
                  style={{ background: "linear-gradient(90deg,#34D399,#F59E0B)", color: "white" }}
                >
                  {streaming ? "Streaming..." : "Stream"}
                </button>
                <button
                  onClick={() => { setQuery(""); setResponses([]); setLikedModelId(null); setStreaming(false); }}
                  className="px-3 py-2 rounded-xl border"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="mt-4">
              <div className="flex items-center justify-between">
                <div className="text-xs opacity-70 mb-2">Available models</div>
                <button onClick={() => setModelsCollapsed(s => !s)} className="text-xs underline opacity-70">
                  {modelsCollapsed ? "Show" : "Hide"}
                </button>
              </div>

              {!modelsCollapsed && (
                <div className="mt-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-sm font-semibold">OpenAI</div>
                        {openAIModels.length > 5 && (
                          <button onClick={() => setShowAllOpenAI(s => !s)} className="text-xs underline opacity-70">
                            {showAllOpenAI ? "Show less" : `Show all (${openAIModels.length})`}
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap">
                        {displayedOpenAI.map(m => (
                          <ModelPill key={m.id} model={m} selected={selected.includes(m.id)} disabled={streaming} onToggle={toggleModel} />
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-sm font-semibold">Anthropics</div>
                        {anthropicModels.length > 5 && (
                          <button onClick={() => setShowAllAnthropic(s => !s)} className="text-xs underline opacity-70">
                            {showAllAnthropic ? "Show less" : `Show all (${anthropicModels.length})`}
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap">
                        {displayedAnthropic.map(m => (
                          <ModelPill key={m.id} model={m} selected={selected.includes(m.id)} disabled={streaming} onToggle={toggleModel} />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

            </div>
          </div>

          <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {responses.map(r => (
              <ResponseCard
                key={r.modelId}
                r={r}
                liked={likedModelId === r.modelId}
                onLike={onLike}
                recommended={recommendedId === r.modelId}
              />
            ))}
          </section>

          {responses.length > 0 && (
            <div className="text-sm opacity-70">Recommended: {responses.find(x => x.modelId === recommendedId)?.modelDisplay || "—"}</div>
          )}

          <footer className="text-xs opacity-60">Tip: Use Stream for progressive results. Like a response to pin recommendation.</footer>
        </main>
      </div>
    </div>
  );
}