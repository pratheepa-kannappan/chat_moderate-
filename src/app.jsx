import { useState, useEffect, useRef, useCallback } from "react";

// ─── GLOBALS ──────────────────────────────────────────────────────────────────
const BASE = "";  // vite proxies /api → localhost:3001
const VIOLATION_LIMIT = 3;

const TOXICITY_COLORS = {
  SAFE:     { bg:"#052e16", border:"#16a34a", text:"#4ade80", label:"SAFE",        dot:"#16a34a" },
  LOW:      { bg:"#1c1917", border:"#d97706", text:"#fbbf24", label:"LOW RISK",    dot:"#d97706" },
  MEDIUM:   { bg:"#1c0a00", border:"#ea580c", text:"#fb923c", label:"MEDIUM RISK", dot:"#ea580c" },
  HIGH:     { bg:"#1c0000", border:"#dc2626", text:"#f87171", label:"HIGH RISK",   dot:"#dc2626" },
  CRITICAL: { bg:"#0f0000", border:"#7f1d1d", text:"#ef4444", label:"⚠ CRITICAL",  dot:"#991b1b" },
};

const FONTS = `@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap');`;
const BASE_STYLES = `
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:#060a10;font-family:'Syne',sans-serif;}
  ::-webkit-scrollbar{width:3px;}::-webkit-scrollbar-track{background:#0f172a;}::-webkit-scrollbar-thumb{background:#334155;border-radius:2px;}
  @keyframes fadeIn{from{opacity:0}to{opacity:1}}
  @keyframes fadeInUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
  @keyframes slideUp{from{opacity:0;transform:translateY(24px) scale(0.97)}to{opacity:1;transform:translateY(0) scale(1)}}
  @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
  @keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
  input:focus,textarea:focus{border-color:#4f46e5!important;outline:none;}
  button:hover{opacity:0.9;}
`;

// ─── API HELPERS ──────────────────────────────────────────────────────────────
async function api(path, opts = {}, token = null) {
  const headers = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const res = await fetch(`${BASE}${path}`, { headers, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ─── AGENTIC MODERATION ENGINE ────────────────────────────────────────────────
async function moderateMessage(message, group, user, recentMsgs, token, globalRules=[]) {
  // Step 1: Agentic context resolution
  let contextResult = null;
  try {
    contextResult = await api('/api/agent/resolve-context', {
      method: 'POST',
      body: { skillset: user.skillset || '', groupId: group.id, message },
    }, token);
  } catch (e) { console.warn('Context resolver failed:', e.message); }

  const historyCtx = recentMsgs.slice(-3).map(m => `[${m.userName}]: ${m.text}`).join('\n') || 'No prior messages';
  const contextNote = contextResult
    ? `AGENTIC CONTEXT ANALYSIS: relevance_score=${contextResult.relevance_score}, is_relevant=${contextResult.is_relevant}, reasoning="${contextResult.reasoning}"`
    : 'Context analysis unavailable';

  const prompt = `You are a STRICT but INTELLIGENT AI content moderator for EAGLE EYE, a professional learning platform. You understand semantics and context deeply — not just keywords.

===== GROUP CONTEXT =====
Group: "${group.name}"
Description: "${group.description}"
Semantic scope: "${group.semanticContext}"
Explicitly disallowed topics: ${group.disallowed.join(', ')}

===== USER CONTEXT =====  
User skillset/background: "${user.skillset || 'Not provided'}"
User role: "${user.role}"

===== RECENT CONVERSATION =====
${historyCtx}

===== AGENTIC PRE-ANALYSIS =====
${contextNote}

===== MESSAGE TO MODERATE =====
"${message}"

===== INTELLIGENT MODERATION RULES =====
Understand SEMANTICS not just keywords. Examples:
- "How do I use pandas for data cleaning?" in Data Science group → SAFE (semantically relevant even if 'pandas' not in keyword list)
- "Python ML question" in Data Science group → SAFE (Python IS relevant to ML even if group says Java)  
- "Can I use Python to call a Java REST API?" in Java group → SAFE (cross-stack integration is relevant)
- "What movie should I watch tonight?" → ALWAYS BLOCK (entertainment, zero learning value)
- "Modi is good/bad" → ALWAYS BLOCK (political)
- "Call me at 9876543210" → ALWAYS BLOCK (personal info)
- "Check my course for 50% off" → ALWAYS BLOCK (promotion)

USE SEMANTIC UNDERSTANDING for topic relevance. The agentic pre-analysis above is a strong hint.

BLOCK if ANY of these apply (AI-semantic judgment, not keyword):
1. ABUSIVE: hate speech, insults, aggressive, unprofessional
2. PERSONAL_INFO: phone, email, address, passwords, OTPs, IDs
3. POLITICAL_RELIGIOUS: politics, religion, elections, parties
4. PROMOTION: ads, courses for sale, referrals, "check out my"
5. FINANCIAL: crypto, stocks, gambling, trading tips
6. ILLEGAL: piracy, cheating, hacking tutorials
7. SPAM: pure noise, repeated content, no learning value
8. OFF_TOPIC: semantically unrelated to the group's educational purpose (use context analysis)

ALLOW if:
- Directly relevant to group topic (use semantic judgment)
- Cross-domain but legitimately connected to group learning
- General programming/tech questions that support learning
- Professional and educational in tone

Respond ONLY in valid JSON (no markdown):
{
  "allowed": true or false,
  "toxicity_level": "SAFE" or "LOW" or "MEDIUM" or "HIGH" or "CRITICAL",
  "toxicity_score": 0-100,
  "violation_category": "abusive_language"|"personal_info"|"political_religious"|"promotion_spam"|"off_topic"|"financial_gambling"|"illegal_unsafe"|"low_quality"|"none",
  "violations": ["specific violation descriptions"],
  "categories": {
    "abusive_language": 0-100,
    "personal_info": 0-100,
    "political_religious": 0-100,
    "promotion_spam": 0-100,
    "off_topic": 0-100,
    "financial_gambling": 0-100,
    "illegal_unsafe": 0-100,
    "low_quality": 0-100
  },
  "semantic_reasoning": "Brief explanation of the semantic judgment made",
  "feedback": "Polite, educational explanation if blocked. Empty string if allowed.",
  "suggestion": "Constructive alternative if blocked. Empty string if allowed.",
  "rewrite_suggestion": "Corrected version if fixable, else null",
  "intent_analysis": "learning|spam|social|hostile|offtopic|personal",
  "tone": "professional|casual|aggressive|friendly|neutral",
  "confidence": 0-100
}`;

  let res, data;
  try {
    res = await fetch('/api/moderate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }),
    });
    data = await res.json();
  } catch (e) {
    return errorResult('Network error — is npm run dev running?');
  }
  if (!res.ok || data.error) return errorResult(`API Error: ${data.error}`);

  const raw = data.content?.[0]?.text || '';
  let result;
  try { result = JSON.parse(raw.replace(/```json|```/g, '').trim()); }
  catch { return errorResult('Could not parse AI response. Try again.'); }

  result.contextAnalysis = contextResult;
  if (result.allowed && result.toxicity_score > 55) {
    result.allowed = false;
    result.feedback = result.feedback || 'This message may not meet community standards.';
  }
  // Check if the violation category's rule is disabled by admin
  if (!result.allowed && result.violation_category) {
    const rule = globalRules.find(r => r.id === result.violation_category);
    if (rule && !rule.enabled) {
      // Admin turned this rule off — allow the message with a note
      result.allowed = true;
      result.toxicity_level = 'LOW';
      result.admin_override = true;
      result.feedback = '';
    }
  }
  // Post stats event (fire and forget)
  fetch('/api/stats/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ allowed: result.allowed, violation_category: result.violation_category, groupId: group.id, userId: user.id, toxicity_level: result.toxicity_level, userName: user.name }),
  }).catch(() => {});
  return result;
}

function errorResult(msg) {
  return { allowed: false, toxicity_level: 'MEDIUM', toxicity_score: 0, violation_category: 'none',
    violations: [msg], categories: {abusive_language:0,personal_info:0,political_religious:0,promotion_spam:0,off_topic:0,financial_gambling:0,illegal_unsafe:0,low_quality:0},
    feedback: msg, suggestion: 'Check your connection and API key.', rewrite_suggestion: null,
    intent_analysis: 'unknown', tone: 'neutral', confidence: 0, source: 'error' };
}

// ─── SHARED COMPONENTS ────────────────────────────────────────────────────────
function Spinner({ size = 16, color = "#818cf8" }) {
  return <div style={{ width: size, height: size, border: `2px solid #475569`, borderTopColor: color, borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />;
}
function ToxBar({ score, color }) {
  return <div style={{ background:'#0f172a', borderRadius:4, height:5, overflow:'hidden', flex:1 }}>
    <div style={{ height:'100%', width:`${score}%`, background:color, transition:'width 0.7s ease', boxShadow:`0 0 6px ${color}88` }} />
  </div>;
}
function Badge({ result }) {
  if (!result) return null;
  const c = TOXICITY_COLORS[result.toxicity_level] || TOXICITY_COLORS.SAFE;
  return <span style={{ display:'inline-flex', alignItems:'center', gap:5, background:c.bg, border:`1px solid ${c.border}`, borderRadius:20, padding:'2px 10px', fontSize:10, fontFamily:'monospace', color:c.text, fontWeight:700, letterSpacing:1 }}>
    <span style={{ width:6, height:6, borderRadius:'50%', background:c.dot, boxShadow:`0 0 5px ${c.dot}`, display:'inline-block' }} />
    {c.label} · {result.toxicity_score}%
  </span>;
}

// ─── API KEY SCREEN ───────────────────────────────────────────────────────────
function ApiKeyScreen({ onDone }) {
  const [key, setKey] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!key.trim()) return;
    setLoading(true); setErr('');
    try {
      await api('/api/set-key', { method: 'POST', body: { apiKey: key.trim() } });
      onDone();
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight:'100vh', background:'#060a10', display:'flex', alignItems:'center', justifyContent:'center', padding:20, fontFamily:"'Syne',sans-serif", position:'relative' }}>
      <div style={{ position:'fixed', inset:0, pointerEvents:'none', background:'radial-gradient(ellipse 60% 50% at 50% 40%,#6366f114 0%,transparent 70%)' }} />
      <div style={{ background:'#0d1117', border:'1px solid #1e293b', borderRadius:20, padding:36, maxWidth:460, width:'100%', animation:'fadeInUp 0.5s ease', position:'relative', zIndex:1, boxShadow:'0 0 60px #6366f118' }}>
        <div style={{ textAlign:'center', marginBottom:28 }}>
          <div style={{ width:64, height:64, borderRadius:16, margin:'0 auto 14px', background:'linear-gradient(135deg,#4f46e5,#7c3aed)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:30, boxShadow:'0 0 40px #6366f144' }}>🛡️</div>
          <div style={{ color:'#f8fafc', fontWeight:800, fontSize:22 }}>EAGLE EYE </div>
          <div style={{ color:'#4f46e5', fontSize:10, fontFamily:'monospace', letterSpacing:3, marginTop:3 }}>AI MODERATION ENGINE v3.0</div>
        </div>
        <div style={{ background:'#0f172a', border:'1px solid #1e3a5f', borderRadius:12, padding:14, marginBottom:20 }}>
          <div style={{ color:'#60a5fa', fontSize:12, fontWeight:700, marginBottom:8 }}>🔑 Groq API Key Required (FREE)</div>
          {['Go to → console.groq.com','Sign up free (no credit card)','API Keys → Create API Key','Copy key (starts with gsk_...)','Paste below and click Activate'].map((s,i)=>(
            <div key={i} style={{ display:'flex', gap:7, color:'#64748b', fontSize:11, fontFamily:'monospace', marginBottom:3 }}>
              <span style={{ color:'#4f46e5' }}>{i+1}.</span><span>{s}</span>
            </div>
          ))}
        </div>
        <input type="password" value={key} onChange={e=>{setKey(e.target.value);setErr('');}} onKeyDown={e=>e.key==='Enter'&&submit()} placeholder="gsk_..." style={{ width:'100%', padding:'11px 14px', background:'#0f172a', border:`1px solid ${err?'#dc2626':'#334155'}`, borderRadius:9, color:'#e2e8f0', fontSize:13, fontFamily:'monospace', outline:'none', marginBottom:8 }} />
        {err && <div style={{ color:'#f87171', fontSize:11, fontFamily:'monospace', marginBottom:8 }}>⚠ {err}</div>}
        <button onClick={submit} disabled={loading||!key.trim()} style={{ width:'100%', padding:'12px', background:loading?'#1e293b':'linear-gradient(135deg,#4f46e5,#7c3aed)', border:'none', borderRadius:9, color:'white', cursor:loading?'not-allowed':'pointer', fontFamily:"'Syne',sans-serif", fontSize:14, fontWeight:700 }}>
          {loading ? <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:8}}><Spinner />Activating...</div> : '🚀 Activate EAGLE EYE '}
        </button>
        <div style={{ marginTop:14, background:'#0f172a', border:'1px solid #1e293b', borderRadius:9, padding:12 }}>
          <div style={{ color:'#475569', fontSize:11, fontWeight:700, marginBottom:5 }}>💡 .env shortcut</div>
          <div style={{ background:'#020617', borderRadius:5, padding:'7px 11px', fontFamily:'monospace', fontSize:11, color:'#4ade80' }}>GROQ_API_KEY=gsk_your_key_here</div>
        </div>
      </div>
    </div>
  );
}

// ─── LOGIN SCREEN ─────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [tab, setTab] = useState('login'); // 'login' | 'register'

  // Login state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginErr, setLoginErr] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // Register state
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirm, setRegConfirm] = useState('');
  const [regErr, setRegErr] = useState('');
  const [regLoading, setRegLoading] = useState(false);

  const doLogin = async () => {
    if (!email || !password) return;
    setLoginLoading(true); setLoginErr('');
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: { email, password } });
      onLogin(data.token, data.user);
    } catch (e) { setLoginErr(e.message); }
    finally { setLoginLoading(false); }
  };

  const doRegister = async () => {
    if (!regName.trim() || !regEmail || !regPassword) { setRegErr('All fields are required.'); return; }
    if (regPassword !== regConfirm) { setRegErr('Passwords do not match.'); return; }
    if (regPassword.length < 6) { setRegErr('Password must be at least 6 characters.'); return; }
    setRegLoading(true); setRegErr('');
    try {
      const data = await api('/api/auth/register', { method: 'POST', body: { name: regName.trim(), email: regEmail.trim(), password: regPassword } });
      onLogin(data.token, data.user);
    } catch (e) { setRegErr(e.message); }
    finally { setRegLoading(false); }
  };

  const demoAccounts = [
    { label: '👑 Admin', email: 'admin@wele.com', password: 'admin123', color: '#6366f1' },
    { label: '👤 Learner', email: 'alex@wele.com', password: 'user123', color: '#8b5cf6' },
    { label: '🎓 Mentor', email: 'priya@wele.com', password: 'user123', color: '#06b6d4' },
  ];

  return (
    <div style={{ minHeight:'100vh', background:'#060a10', display:'flex', alignItems:'center', justifyContent:'center', padding:20, fontFamily:"'Syne',sans-serif" }}>
      <div style={{ position:'fixed', inset:0, pointerEvents:'none', background:'radial-gradient(ellipse 50% 60% at 30% 50%,#6366f110 0%,transparent 60%),radial-gradient(ellipse 40% 50% at 70% 50%,#8b5cf608 0%,transparent 60%)' }} />
      <div style={{ width:'100%', maxWidth:440, position:'relative', zIndex:1, animation:'fadeInUp 0.5s ease' }}>

        {/* Logo */}
        <div style={{ textAlign:'center', marginBottom:28 }}>
          <div style={{ width:70, height:70, borderRadius:18, margin:'0 auto 14px', background:'linear-gradient(135deg,#4f46e5,#7c3aed)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:32, boxShadow:'0 0 50px #6366f144' }}>🛡️</div>
          <div style={{ color:'#f8fafc', fontWeight:800, fontSize:22, letterSpacing:0.5 }}>EAGLE EYE </div>
          <div style={{ color:'#4f46e5', fontSize:10, fontFamily:'monospace', letterSpacing:3, marginTop:3 }}>AI MODERATION ENGINE v3.0</div>
        </div>

        <div style={{ background:'#0d1117', border:'1px solid #1e293b', borderRadius:20, overflow:'hidden', boxShadow:'0 0 60px #6366f110' }}>

          {/* Tabs */}
          <div style={{ display:'flex', borderBottom:'1px solid #1e293b' }}>
            {[['login','Sign In'],['register','Create Account']].map(([t,label])=>(
              <button key={t} onClick={()=>{ setTab(t); setLoginErr(''); setRegErr(''); }} style={{ flex:1, padding:'14px', background:'none', border:'none', borderBottom:tab===t?'2px solid #6366f1':'2px solid transparent', color:tab===t?'#818cf8':'#475569', cursor:'pointer', fontFamily:"'Syne',sans-serif", fontSize:13, fontWeight:700, transition:'all 0.2s' }}>{label}</button>
            ))}
          </div>

          <div style={{ padding:28 }}>

            {/* ── LOGIN TAB ── */}
            {tab==='login' && (
              <>
                <div style={{ marginBottom:12 }}>
                  <label style={{ color:'#64748b', fontSize:10, fontFamily:'monospace', textTransform:'uppercase', letterSpacing:1, display:'block', marginBottom:6 }}>Email</label>
                  <input value={email} onChange={e=>{setEmail(e.target.value);setLoginErr('');}} onKeyDown={e=>e.key==='Enter'&&doLogin()} type="email" placeholder="your@email.com" style={{ width:'100%', padding:'10px 13px', background:'#0f172a', border:'1px solid #334155', borderRadius:9, color:'#e2e8f0', fontSize:13, fontFamily:'monospace', outline:'none' }} />
                </div>
                <div style={{ marginBottom:16 }}>
                  <label style={{ color:'#64748b', fontSize:10, fontFamily:'monospace', textTransform:'uppercase', letterSpacing:1, display:'block', marginBottom:6 }}>Password</label>
                  <input value={password} onChange={e=>{setPassword(e.target.value);setLoginErr('');}} onKeyDown={e=>e.key==='Enter'&&doLogin()} type="password" placeholder="••••••••" style={{ width:'100%', padding:'10px 13px', background:'#0f172a', border:'1px solid #334155', borderRadius:9, color:'#e2e8f0', fontSize:13, fontFamily:'monospace', outline:'none' }} />
                </div>
                {loginErr && <div style={{ background:'#1c0000', border:'1px solid #dc262655', borderRadius:8, padding:'8px 12px', color:'#f87171', fontSize:12, fontFamily:'monospace', marginBottom:12 }}>⚠ {loginErr}</div>}
                <button onClick={doLogin} disabled={loginLoading||!email||!password} style={{ width:'100%', padding:'12px', background:loginLoading?'#1e293b':'linear-gradient(135deg,#4f46e5,#7c3aed)', border:'none', borderRadius:9, color:'white', cursor:loginLoading?'not-allowed':'pointer', fontFamily:"'Syne',sans-serif", fontSize:14, fontWeight:700, marginBottom:20 }}>
                  {loginLoading?<div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:8}}><Spinner />Signing in...</div>:'Sign In →'}
                </button>
                <div style={{ borderTop:'1px solid #1e293b', paddingTop:16 }}>
                  <div style={{ color:'#334155', fontSize:10, fontFamily:'monospace', textAlign:'center', marginBottom:10, textTransform:'uppercase', letterSpacing:1 }}>Quick Demo Logins</div>
                  <div style={{ display:'flex', gap:6 }}>
                    {demoAccounts.map(acc=>(
                      <button key={acc.email} onClick={()=>{setEmail(acc.email);setPassword(acc.password);}} style={{ flex:1, padding:'8px 10px', background:'#0f172a', border:`1px solid ${acc.color}44`, borderRadius:8, color:acc.color, cursor:'pointer', fontSize:11, fontFamily:"'Syne',sans-serif", fontWeight:600, textAlign:'center' }}>
                        {acc.label}
                      </button>
                    ))}
                  </div>
                  <div style={{ marginTop:8, color:'#334155', fontSize:10, fontFamily:'monospace', textAlign:'center' }}>
                    No account yet? <button onClick={()=>setTab('register')} style={{ background:'none', border:'none', color:'#6366f1', cursor:'pointer', fontSize:10, fontFamily:'monospace', textDecoration:'underline', padding:0 }}>Create one →</button>
                  </div>
                </div>
              </>
            )}

            {/* ── REGISTER TAB ── */}
            {tab==='register' && (
              <>
                <div style={{ background:'#0f172a', border:'1px solid #1e3a5f', borderRadius:10, padding:12, marginBottom:18 }}>
                  <div style={{ color:'#60a5fa', fontSize:11, fontWeight:700, marginBottom:5 }}>🎓 Join EAGLE EYE Learning Community</div>
                  <div style={{ color:'#475569', fontSize:11, lineHeight:1.6 }}>Create a free account to join moderated learning groups. After registering you'll pick your group and optionally share your background so the AI can personalise moderation for you.</div>
                </div>
                <div style={{ marginBottom:11 }}>
                  <label style={{ color:'#64748b', fontSize:10, fontFamily:'monospace', textTransform:'uppercase', letterSpacing:1, display:'block', marginBottom:5 }}>Full Name</label>
                  <input value={regName} onChange={e=>{setRegName(e.target.value);setRegErr('');}} onKeyDown={e=>e.key==='Enter'&&doRegister()} type="text" placeholder="Ravi Kumar" style={{ width:'100%', padding:'10px 13px', background:'#0f172a', border:'1px solid #334155', borderRadius:9, color:'#e2e8f0', fontSize:13, fontFamily:'monospace', outline:'none' }} />
                </div>
                <div style={{ marginBottom:11 }}>
                  <label style={{ color:'#64748b', fontSize:10, fontFamily:'monospace', textTransform:'uppercase', letterSpacing:1, display:'block', marginBottom:5 }}>Email</label>
                  <input value={regEmail} onChange={e=>{setRegEmail(e.target.value);setRegErr('');}} type="email" placeholder="ravi@example.com" style={{ width:'100%', padding:'10px 13px', background:'#0f172a', border:'1px solid #334155', borderRadius:9, color:'#e2e8f0', fontSize:13, fontFamily:'monospace', outline:'none' }} />
                </div>
                <div style={{ marginBottom:11 }}>
                  <label style={{ color:'#64748b', fontSize:10, fontFamily:'monospace', textTransform:'uppercase', letterSpacing:1, display:'block', marginBottom:5 }}>Password</label>
                  <input value={regPassword} onChange={e=>{setRegPassword(e.target.value);setRegErr('');}} type="password" placeholder="Min. 6 characters" style={{ width:'100%', padding:'10px 13px', background:'#0f172a', border:'1px solid #334155', borderRadius:9, color:'#e2e8f0', fontSize:13, fontFamily:'monospace', outline:'none' }} />
                </div>
                <div style={{ marginBottom:16 }}>
                  <label style={{ color:'#64748b', fontSize:10, fontFamily:'monospace', textTransform:'uppercase', letterSpacing:1, display:'block', marginBottom:5 }}>Confirm Password</label>
                  <input value={regConfirm} onChange={e=>{setRegConfirm(e.target.value);setRegErr('');}} onKeyDown={e=>e.key==='Enter'&&doRegister()} type="password" placeholder="Re-enter password" style={{ width:'100%', padding:'10px 13px', background:'#0f172a', border:`1px solid ${regConfirm&&regPassword&&regConfirm!==regPassword?'#dc2626':'#334155'}`, borderRadius:9, color:'#e2e8f0', fontSize:13, fontFamily:'monospace', outline:'none' }} />
                  {regConfirm && regPassword && regConfirm !== regPassword && <div style={{ color:'#f87171', fontSize:10, fontFamily:'monospace', marginTop:4 }}>Passwords do not match</div>}
                </div>
                {regErr && <div style={{ background:'#1c0000', border:'1px solid #dc262655', borderRadius:8, padding:'8px 12px', color:'#f87171', fontSize:12, fontFamily:'monospace', marginBottom:12 }}>⚠ {regErr}</div>}
                <button onClick={doRegister} disabled={regLoading||!regName||!regEmail||!regPassword||!regConfirm} style={{ width:'100%', padding:'12px', background:regLoading?'#1e293b':'linear-gradient(135deg,#059669,#047857)', border:'none', borderRadius:9, color:'white', cursor:regLoading?'not-allowed':'pointer', fontFamily:"'Syne',sans-serif", fontSize:14, fontWeight:700, marginBottom:14 }}>
                  {regLoading?<div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:8}}><Spinner />Creating account...</div>:'🚀 Create Account →'}
                </button>
                <div style={{ color:'#334155', fontSize:10, fontFamily:'monospace', textAlign:'center' }}>
                  Already have an account? <button onClick={()=>setTab('login')} style={{ background:'none', border:'none', color:'#6366f1', cursor:'pointer', fontSize:10, fontFamily:'monospace', textDecoration:'underline', padding:0 }}>Sign in →</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── USER SETUP SCREEN (skillset + group selection) ───────────────────────────
function UserSetupScreen({ user, token, groups, onDone }) {
  const [skillset, setSkillset] = useState(user.skillset || '');
  const [groupId, setGroupId] = useState(user.groupId || '');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1); // step 1 = group, step 2 = skills

  const submit = async () => {
    if (!groupId) return;
    setLoading(true);
    try {
      await api('/api/user/setup', { method: 'POST', body: { skillset, groupId } }, token);
      onDone({ ...user, skillset, groupId });
    } catch(e) { alert(e.message); }
    finally { setLoading(false); }
  };

  const selectedGroup = groups.find(g => g.id === groupId);

  return (
    <div style={{ minHeight:'100vh', background:'#060a10', display:'flex', alignItems:'center', justifyContent:'center', padding:20, fontFamily:"'Syne',sans-serif" }}>
      <div style={{ position:'fixed', inset:0, pointerEvents:'none', background:'radial-gradient(ellipse 60% 50% at 50% 40%,#8b5cf610 0%,transparent 70%)' }} />
      <div style={{ background:'#0d1117', border:'1px solid #1e293b', borderRadius:20, maxWidth:540, width:'100%', animation:'fadeInUp 0.5s ease', position:'relative', zIndex:1, overflow:'hidden' }}>

        {/* Header */}
        <div style={{ padding:'24px 28px 0', textAlign:'center' }}>
          <div style={{ fontSize:30, marginBottom:8 }}>👋</div>
          <div style={{ color:'#f8fafc', fontWeight:800, fontSize:18 }}>Welcome, {user.name}!</div>
          <div style={{ color:'#64748b', fontSize:12, marginTop:4, marginBottom:20 }}>Complete your profile to enter the community</div>
          {/* Step indicator */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, marginBottom:0 }}>
            {[1,2].map(s=>(
              <div key={s} style={{ display:'flex', alignItems:'center', gap:8 }}>
                <div style={{ width:28, height:28, borderRadius:'50%', background:step>=s?'linear-gradient(135deg,#4f46e5,#7c3aed)':'#1e293b', border:`1px solid ${step>=s?'#6366f1':'#334155'}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, color:step>=s?'white':'#475569', transition:'all 0.3s' }}>{s}</div>
                <span style={{ color:step===s?'#94a3b8':'#475569', fontSize:11 }}>{s===1?'Choose Group':'Your Background'}</span>
                {s<2 && <div style={{ width:24, height:1, background:step>s?'#6366f1':'#1e293b', transition:'background 0.3s' }} />}
              </div>
            ))}
          </div>
        </div>

        <div style={{ padding:'20px 28px 28px' }}>

          {/* ── STEP 1: Group selection ── */}
          {step===1 && (
            <>
              <div style={{ color:'#94a3b8', fontSize:11, fontFamily:'monospace', textTransform:'uppercase', letterSpacing:1, marginBottom:12 }}>Select Your Learning Group</div>
              <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:20 }}>
                {groups.map(g=>(
                  <button key={g.id} onClick={()=>setGroupId(g.id)} style={{ padding:'13px 16px', background:groupId===g.id?'#1e293b':'#0f172a', border:`2px solid ${groupId===g.id?g.color+'99':'#1e293b'}`, borderRadius:11, cursor:'pointer', textAlign:'left', display:'flex', alignItems:'center', gap:12, transition:'all 0.2s' }}>
                    <span style={{ fontSize:22 }}>{g.icon}</span>
                    <div style={{ flex:1 }}>
                      <div style={{ color:groupId===g.id?'#f8fafc':'#94a3b8', fontWeight:700, fontSize:13 }}>{g.name}</div>
                      <div style={{ color:'#475569', fontSize:10, fontFamily:'monospace', marginTop:2, lineHeight:1.5 }}>{g.description?.slice(0,75)}...</div>
                      <div style={{ display:'flex', flexWrap:'wrap', gap:3, marginTop:6 }}>
                        {(g.allowed||[]).slice(0,4).map(t=><span key={t} style={{ background:'#052e16', border:'1px solid #16a34a33', color:'#4ade80', padding:'1px 6px', borderRadius:4, fontSize:8, fontFamily:'monospace' }}>{t}</span>)}
                      </div>
                    </div>
                    <div style={{ width:22, height:22, borderRadius:'50%', background:groupId===g.id?g.color:'#1e293b', border:`2px solid ${groupId===g.id?g.color:'#334155'}`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, transition:'all 0.2s' }}>
                      {groupId===g.id && <span style={{ color:'white', fontSize:12 }}>✓</span>}
                    </div>
                  </button>
                ))}
              </div>
              <button onClick={()=>setStep(2)} disabled={!groupId} style={{ width:'100%', padding:'12px', background:!groupId?'#1e293b':'linear-gradient(135deg,#4f46e5,#7c3aed)', border:'none', borderRadius:9, color:'white', cursor:!groupId?'not-allowed':'pointer', fontFamily:"'Syne',sans-serif", fontSize:14, fontWeight:700 }}>
                Continue → Set up profile
              </button>
            </>
          )}

          {/* ── STEP 2: Skills + explanation ── */}
          {step===2 && (
            <>
              {/* Clear explanation card */}
              <div style={{ background:'#0f172a', border:'1px solid #1e3a5f', borderRadius:12, padding:16, marginBottom:18 }}>
                <div style={{ color:'#60a5fa', fontSize:12, fontWeight:700, marginBottom:10 }}>🤖 Why does the AI need your background?</div>
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {[
                    { icon:'🎯', title:'Fairer moderation', desc:`You joined "${selectedGroup?.name}". The AI knows this group's rules. But without knowing YOU, it might flag a valid question as off-topic.` },
                    { icon:'💡', title:'Concrete example', desc:`If you write "can I use Python for data preprocessing before the Java step?" — without your background, AI might block it as off-topic. With your background (e.g. "cross-stack developer"), the AI understands why you're asking.` },
                    { icon:'✅', title:'What it changes', desc:'The AI becomes more lenient with genuine cross-domain questions relevant to YOUR learning path, while staying strict about unrelated content.' },
                    { icon:'🔒', title:'Completely optional', desc:'You can skip this and the AI will still work — just with less personalised context. You can update it anytime.' },
                  ].map(({icon,title,desc})=>(
                    <div key={title} style={{ display:'flex', gap:10, padding:'8px 0', borderBottom:'1px solid #1e293b' }}>
                      <span style={{ fontSize:16, flexShrink:0 }}>{icon}</span>
                      <div>
                        <div style={{ color:'#94a3b8', fontSize:11, fontWeight:700, marginBottom:2 }}>{title}</div>
                        <div style={{ color:'#475569', fontSize:11, lineHeight:1.6 }}>{desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom:18 }}>
                <label style={{ color:'#94a3b8', fontSize:11, fontFamily:'monospace', textTransform:'uppercase', letterSpacing:1, display:'block', marginBottom:8 }}>
                  Your Background <span style={{ color:'#334155', textTransform:'none', letterSpacing:0, fontFamily:"'Syne',sans-serif" }}>(optional but recommended)</span>
                </label>
                <textarea value={skillset} onChange={e=>setSkillset(e.target.value)} placeholder={`Examples:
• "2 years of Java, learning Spring Boot microservices"
• "Data analyst switching to ML, know Python basics"
• "Fresher joining ${selectedGroup?.name} to upskill"`} rows={4} style={{ width:'100%', padding:'10px 13px', background:'#0f172a', border:'1px solid #334155', borderRadius:9, color:'#e2e8f0', fontSize:12, fontFamily:'monospace', resize:'none', lineHeight:1.6, outline:'none' }} />
              </div>

              <div style={{ display:'flex', gap:10 }}>
                <button onClick={()=>setStep(1)} style={{ padding:'11px 18px', background:'#1e293b', border:'1px solid #334155', borderRadius:9, color:'#94a3b8', cursor:'pointer', fontFamily:"'Syne',sans-serif", fontSize:13 }}>← Back</button>
                <button onClick={submit} disabled={loading} style={{ flex:1, padding:'11px', background:loading?'#1e293b':'linear-gradient(135deg,#4f46e5,#7c3aed)', border:'none', borderRadius:9, color:'white', cursor:loading?'not-allowed':'pointer', fontFamily:"'Syne',sans-serif", fontSize:14, fontWeight:700 }}>
                  {loading?<div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:8}}><Spinner />Setting up...</div>:'🚀 Enter Community →'}
                </button>
              </div>
              {!skillset && <div style={{ color:'#334155', fontSize:10, fontFamily:'monospace', textAlign:'center', marginTop:8 }}>Entering without background — AI will use group context only</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}


// ─── BLOCKED POPUP ────────────────────────────────────────────────────────────
function BlockedPopup({ result, violations, onDismiss, onEdit, onUseRewrite }) {
  const cfg = TOXICITY_COLORS[result.toxicity_level] || TOXICITY_COLORS.HIGH;
  const cats = result.categories || {};
  const ctx = result.contextAnalysis;

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.88)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(14px)', animation:'fadeIn 0.2s ease' }}>
      <div style={{ background:'#0d1117', border:`1px solid ${cfg.border}`, borderRadius:18, padding:24, maxWidth:500, width:'92%', boxShadow:`0 0 60px ${cfg.border}44`, animation:'slideUp 0.3s ease', maxHeight:'90vh', overflowY:'auto' }}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:16 }}>
          <div style={{ width:44, height:44, borderRadius:12, background:cfg.bg, border:`1px solid ${cfg.border}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:20 }}>🛡️</div>
          <div style={{ flex:1 }}>
            <div style={{ color:'#f8fafc', fontWeight:700, fontSize:15 }}>Message Intercepted</div>
            <Badge result={result} />
          </div>
          <span style={{ background:'#1e293b', border:'1px solid #334155', color:'#475569', padding:'2px 8px', borderRadius:6, fontSize:9, fontFamily:'monospace' }}>🤖 AI SEMANTIC</span>
        </div>

        {/* Semantic reasoning — NEW */}
        {result.semantic_reasoning && (
          <div style={{ background:'#0d1f35', border:'1px solid #1e3a5f', borderRadius:10, padding:12, marginBottom:12 }}>
            <div style={{ color:'#60a5fa', fontSize:10, fontFamily:'monospace', textTransform:'uppercase', marginBottom:4 }}>🧠 AI Semantic Reasoning</div>
            <div style={{ color:'#93c5fd', fontSize:12, lineHeight:1.6 }}>{result.semantic_reasoning}</div>
          </div>
        )}

        {/* Agentic context result */}
        {ctx && (
          <div style={{ background:'#0f172a', border:'1px solid #1e293b', borderRadius:10, padding:12, marginBottom:12 }}>
            <div style={{ color:'#64748b', fontSize:10, fontFamily:'monospace', textTransform:'uppercase', marginBottom:6 }}>⚡ Agentic Context Analysis</div>
            <div style={{ display:'flex', gap:8, marginBottom:4, flexWrap:'wrap' }}>
              <span style={{ background:ctx.is_relevant?'#052e16':'#1c0000', border:`1px solid ${ctx.is_relevant?'#16a34a':'#dc2626'}`, color:ctx.is_relevant?'#4ade80':'#f87171', padding:'2px 8px', borderRadius:6, fontSize:10, fontFamily:'monospace' }}>
                {ctx.is_relevant?'✓ Relevant':'✗ Off-topic'}
              </span>
              <span style={{ background:'#1e293b', border:'1px solid #334155', color:'#94a3b8', padding:'2px 8px', borderRadius:6, fontSize:10, fontFamily:'monospace' }}>
                Score: {ctx.relevance_score}%
              </span>
              {ctx.suggested_group && <span style={{ background:'#1c1917', border:'1px solid #d97706', color:'#fbbf24', padding:'2px 8px', borderRadius:6, fontSize:10, fontFamily:'monospace' }}>Better group: {ctx.suggested_group}</span>}
            </div>
            <div style={{ color:'#475569', fontSize:11 }}>{ctx.reasoning}</div>
          </div>
        )}

        {/* Feedback */}
        <div style={{ background:'#1e293b', borderRadius:10, padding:12, marginBottom:12, borderLeft:`3px solid ${cfg.border}` }}>
          <div style={{ color:'#64748b', fontSize:10, fontFamily:'monospace', marginBottom:4, textTransform:'uppercase' }}>Why blocked?</div>
          <div style={{ color:'#e2e8f0', fontSize:13, lineHeight:1.65 }}>{result.feedback}</div>
        </div>

        {/* Violations */}
        {result.violations?.length > 0 && (
          <div style={{ marginBottom:12 }}>
            <div style={{ color:'#64748b', fontSize:10, fontFamily:'monospace', marginBottom:6, textTransform:'uppercase' }}>Violations</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
              {result.violations.map((v,i)=><span key={i} style={{ background:'#1c1917', border:`1px solid ${cfg.border}55`, color:cfg.text, padding:'2px 9px', borderRadius:20, fontSize:11, fontFamily:'monospace' }}>{v}</span>)}
            </div>
          </div>
        )}

        {/* Violation warning */}
        {violations > 0 && (
          <div style={{ background:'#1c0a00', border:'1px solid #ea580c55', borderRadius:8, padding:'8px 12px', marginBottom:12, display:'flex', alignItems:'center', gap:8 }}>
            <span>⚠️</span>
            <span style={{ color:'#fb923c', fontSize:11, fontFamily:'monospace', flex:1 }}>
              Violation {violations}/{VIOLATION_LIMIT} — {VIOLATION_LIMIT-violations} more will result in automatic removal
            </span>
            <div style={{ display:'flex', gap:3 }}>
              {Array.from({length:VIOLATION_LIMIT}).map((_,i)=>(
                <div key={i} style={{ width:7, height:7, borderRadius:'50%', background:i<violations?'#ef4444':'#1e293b', border:'1px solid #334155' }} />
              ))}
            </div>
          </div>
        )}

        {/* Rewrite suggestion */}
        {result.rewrite_suggestion && (
          <div style={{ background:'#0d2035', border:'1px solid #1d4ed8', borderRadius:10, padding:12, marginBottom:12 }}>
            <div style={{ color:'#60a5fa', fontSize:10, fontFamily:'monospace', marginBottom:6, textTransform:'uppercase' }}>✨ AI Suggested Rewrite</div>
            <div style={{ color:'#93c5fd', fontSize:12, lineHeight:1.6, fontStyle:'italic', marginBottom:8 }}>"{result.rewrite_suggestion}"</div>
            <button onClick={()=>onUseRewrite(result.rewrite_suggestion)} style={{ padding:'5px 12px', background:'#1d4ed8', border:'none', borderRadius:7, color:'white', cursor:'pointer', fontSize:11, fontFamily:'monospace' }}>Use this →</button>
          </div>
        )}

        {/* Suggestion */}
        {result.suggestion && (
          <div style={{ background:'#0d2818', border:'1px solid #166534', borderRadius:10, padding:12, marginBottom:12 }}>
            <div style={{ color:'#4ade80', fontSize:10, fontFamily:'monospace', marginBottom:4, textTransform:'uppercase' }}>💡 Suggestion</div>
            <div style={{ color:'#86efac', fontSize:12, lineHeight:1.6 }}>{result.suggestion}</div>
          </div>
        )}

        {/* Risk categories */}
        <div style={{ background:'#0f172a', borderRadius:10, padding:12, marginBottom:12 }}>
          <div style={{ color:'#64748b', fontSize:10, fontFamily:'monospace', marginBottom:8, textTransform:'uppercase' }}>Risk Analysis</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'4px 10px' }}>
            {Object.entries(cats).map(([k,v])=>{
              const c = v>70?'#ef4444':v>35?'#f59e0b':'#22c55e';
              return <div key={k} style={{ display:'flex', alignItems:'center', gap:5 }}>
                <span style={{ fontSize:9, color:'#475569', fontFamily:'monospace', width:90, textTransform:'uppercase', flexShrink:0 }}>{k.replace(/_/g,' ')}</span>
                <ToxBar score={v} color={c} />
                <span style={{ fontSize:9, color:c, minWidth:22, textAlign:'right', fontFamily:'monospace' }}>{v}</span>
              </div>;
            })}
          </div>
        </div>

        {/* Intent + Tone + Confidence */}
        <div style={{ display:'flex', gap:8, marginBottom:16 }}>
          {[['Intent', result.intent_analysis], ['Tone', result.tone], ['Confidence', result.confidence+'%']].map(([label,val])=>(
            <div key={label} style={{ flex:1, background:'#0f172a', border:'1px solid #1e293b', borderRadius:8, padding:'8px 10px' }}>
              <div style={{ color:'#475569', fontSize:9, fontFamily:'monospace', textTransform:'uppercase' }}>{label}</div>
              <div style={{ color:'#94a3b8', fontSize:11, fontWeight:600, marginTop:2, fontFamily:'monospace' }}>{val}</div>
            </div>
          ))}
        </div>

        <div style={{ display:'flex', gap:10 }}>
          <button onClick={onEdit} style={{ flex:1, padding:'10px', background:'#1e293b', border:'1px solid #334155', borderRadius:10, color:'#94a3b8', cursor:'pointer', fontFamily:"'Syne',sans-serif", fontSize:13 }}>✏️ Edit</button>
          <button onClick={onDismiss} style={{ flex:1, padding:'10px', background:`linear-gradient(135deg,${cfg.border}33,${cfg.border}11)`, border:`1px solid ${cfg.border}`, borderRadius:10, color:cfg.text, cursor:'pointer', fontFamily:"'Syne',sans-serif", fontSize:13, fontWeight:600 }}>Got it</button>
        </div>
      </div>
    </div>
  );
}

// ─── BAN POPUP ────────────────────────────────────────────────────────────────
function BanPopup({ name, count, onClose }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.92)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(16px)' }}>
      <div style={{ background:'#0d1117', border:'2px solid #dc2626', borderRadius:18, padding:32, maxWidth:400, width:'92%', boxShadow:'0 0 80px #dc262666', animation:'slideUp 0.35s ease', textAlign:'center' }}>
        <div style={{ fontSize:52, marginBottom:12 }}>⛔</div>
        <div style={{ color:'#f87171', fontWeight:800, fontSize:20, marginBottom:8 }}>Account Suspended</div>
        <div style={{ background:'#1c0000', border:'1px solid #7f1d1d', borderRadius:10, padding:14, marginBottom:16, color:'#fca5a5', fontSize:13, lineHeight:1.7 }}>
          <strong>{name}</strong> has been automatically removed after <strong>{count} repeated violations</strong>.
        </div>
        <div style={{ background:'#0d2818', border:'1px solid #166534', borderRadius:10, padding:12, marginBottom:20, color:'#86efac', fontSize:12, lineHeight:1.6 }}>
          💡 Please contact an admin to review your account and rejoin the community.
        </div>
        <button onClick={onClose} style={{ width:'100%', padding:'11px', background:'#1e293b', border:'1px solid #334155', borderRadius:10, color:'#94a3b8', cursor:'pointer', fontFamily:"'Syne',sans-serif", fontSize:13 }}>Close</button>
      </div>
    </div>
  );
}

// ─── CHAT MESSAGE ─────────────────────────────────────────────────────────────
function ChatMessage({ msg, currentUserId }) {
  const [expanded, setExpanded] = useState(false);
  const isMe = currentUserId === msg.userId;
  const isSystem = msg.userId === '0' || msg.role === 'system';
  const r = msg.moderationResult;

  if (isSystem) return (
    <div style={{ textAlign:'center', padding:'6px 0', animation:'fadeInUp 0.3s ease' }}>
      <span style={{ background:'#1c0000', border:'1px solid #7f1d1d', color:'#f87171', padding:'4px 14px', borderRadius:20, fontSize:11, fontFamily:'monospace' }}>{msg.text}</span>
    </div>
  );

  return (
    <div style={{ display:'flex', gap:9, padding:'5px 0', flexDirection:isMe?'row-reverse':'row', animation:'fadeInUp 0.3s ease' }}>
      <div style={{ width:34, height:34, borderRadius:9, flexShrink:0, background:`${msg.userColor}22`, border:`1px solid ${msg.userColor}55`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700, color:msg.userColor, fontFamily:'monospace' }}>{msg.avatar}</div>
      <div style={{ maxWidth:'74%', display:'flex', flexDirection:'column', gap:3, alignItems:isMe?'flex-end':'flex-start' }}>
        <div style={{ display:'flex', gap:7, alignItems:'center' }}>
          <span style={{ color:msg.userColor, fontSize:11, fontWeight:600 }}>{msg.userName}</span>
          {msg.role==='mentor' && <span style={{ background:'#1e3a5f', border:'1px solid #1d4ed8', color:'#60a5fa', padding:'1px 5px', borderRadius:4, fontSize:9, fontFamily:'monospace' }}>MENTOR</span>}
          <span style={{ color:'#334155', fontSize:10, fontFamily:'monospace' }}>{msg.time || new Date(msg.timestamp||Date.now()).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>
        </div>
        <div onClick={()=>r&&setExpanded(!expanded)} style={{ background:isMe?'#1e293b':'#161b27', border:isMe?'1px solid #334155':'1px solid #1e293b', borderRadius:isMe?'12px 4px 12px 12px':'4px 12px 12px 12px', padding:'9px 13px', color:'#e2e8f0', fontSize:13, lineHeight:1.6, cursor:r?'pointer':'default' }}>
          {msg.text}
        </div>
        {r && <div style={{ display:'flex', alignItems:'center', gap:5 }}><Badge result={r} /><span style={{ color:'#334155', fontSize:9, fontFamily:'monospace' }}>{expanded?'▲':'▼'}</span></div>}
        {expanded && r && (
          <div style={{ background:'#0f172a', border:'1px solid #1e293b', borderRadius:8, padding:10, maxWidth:280 }}>
            {r.semantic_reasoning && <div style={{ color:'#60a5fa', fontSize:10, marginBottom:6, fontFamily:'monospace' }}>🧠 {r.semantic_reasoning}</div>}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'4px 8px' }}>
              {Object.entries(r.categories||{}).map(([k,v])=>{
                const c=v>70?'#ef4444':v>35?'#f59e0b':'#22c55e';
                return <div key={k} style={{ display:'flex', alignItems:'center', gap:4 }}>
                  <span style={{ fontSize:8, color:'#475569', fontFamily:'monospace', width:72, textTransform:'uppercase' }}>{k.replace(/_/g,' ')}</span>
                  <ToxBar score={v} color={c} />
                </div>;
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── LEARNER CHAT VIEW ────────────────────────────────────────────────────────
function LearnerChat({ user, token, onLogout }) {
  const [groups, setGroups]       = useState([]);
  const [activeGroup, setActiveGroup] = useState(null);
  const [messages, setMessages]   = useState([]);
  const [input, setInput]         = useState('');
  const [moderating, setModerating] = useState(false);
  const [blockedResult, setBlockedResult] = useState(null);
  const [violations, setViolations] = useState(0);
  const [isBanned, setIsBanned]   = useState(false);
  const [banNotice, setBanNotice] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [modQueue, setModQueue]   = useState([]);
  const [globalRules, setGlobalRules] = useState([]);
  const chatRef = useRef(null);

  useEffect(()=>{
    api('/api/groups', {}, token).then(gs=>{
      setGroups(gs);
      const g = gs.find(x=>x.id===user.groupId) || gs[0];
      setActiveGroup(g);
    }).catch(console.error);
    api(`/api/violations/${user.id}`, {}, token).then(d=>setViolations(d.count)).catch(()=>{});
    api('/api/global-rules', {}, token).then(setGlobalRules).catch(()=>{});
  }, []);

  useEffect(()=>{
    if (!activeGroup) return;
    api(`/api/messages/${activeGroup.id}`, {}, token).then(setMessages).catch(()=>{});
  }, [activeGroup]);

  useEffect(()=>{ if(chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [messages]);

  const handleSend = useCallback(async ()=>{
    if (!input.trim() || moderating || isBanned) return;
    const text = input.trim();
    setInput('');
    setModerating(true);
    setAnalyzing(true);
    setModQueue(prev=>[...prev, { text, status:'analyzing' }]);

    try {
      const recent = messages.slice(-5);
      const result = await moderateMessage(text, activeGroup, user, recent, token, globalRules);

      setModQueue(prev=>prev.map((q,i)=>i===prev.length-1?{...q,status:result.allowed?'approved':'blocked'}:q));
      setTimeout(()=>setModQueue(prev=>prev.slice(1)), 2500);

      if (result.allowed) {
        const msg = await api('/api/messages', { method:'POST', body:{ text, groupId:activeGroup.id, moderationResult:result }}, token);
        setMessages(prev=>[...prev, msg]);
      } else {
        // Track violation
        const vres = await api(`/api/violations/${user.id}`, { method:'POST', body:{} }, token);
        const newCount = vres.count;
        setViolations(newCount);

        if (vres.banned || newCount >= VIOLATION_LIMIT) {
          setIsBanned(true);
          setBanNotice({ name: user.name, count: newCount });
          // Post system message
          const sysMsg = await api('/api/messages', { method:'POST', body:{ text:`⛔ ${user.name} has been automatically removed after ${VIOLATION_LIMIT} violations.`, groupId:activeGroup.id, role:'system' }}, token);
          setMessages(prev=>[...prev, sysMsg]);
        } else {
          setBlockedResult({ ...result, _violations: newCount });
          setInput(text);
        }
      }
    } catch(err) { console.error(err); setModQueue(prev=>prev.slice(1)); }
    finally { setModerating(false); setTimeout(()=>setAnalyzing(false), 800); }
  }, [input, moderating, isBanned, activeGroup, user, messages, token]);

  const testMessages = [
    { label:'✓ On-topic', text:'How does Spring Boot handle dependency injection with @Autowired vs constructor injection?' },
    { label:'✗ Off-topic', text:'Anyone watching the IPL match tonight? Who do you think will win?' },
    { label:'✗ Abuse', text:'This explanation is completely garbage and whoever wrote this is an idiot' },
    { label:'✗ Promo', text:'Join my course for 50% discount! Limited time offer link in bio' },
    { label:'✗ Personal', text:'My phone number is 9876543210, call me to discuss this' },
    { label:'✗ Political', text:'The current government is destroying the IT sector with their policies' },
    { label:'✓ Cross-domain', text:'Can I use Python scripts to automate Maven builds in a Java project?' },
  ];

  if (!activeGroup) return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'#475569', fontFamily:'monospace' }}><Spinner /> Loading...</div>;

  return (
    <div style={{ height:'100vh', display:'flex', flexDirection:'column', background:'#060a10', color:'#e2e8f0', overflow:'hidden' }}>
      {/* Topbar */}
      <div style={{ display:'flex', alignItems:'center', padding:'0 16px', height:52, borderBottom:'1px solid #1e293b', background:'#060a10dd', backdropFilter:'blur(20px)', zIndex:10, gap:12, flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ width:28, height:28, borderRadius:8, background:'linear-gradient(135deg,#6366f1,#8b5cf6)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, boxShadow:'0 0 16px #6366f144' }}>🛡️</div>
          <div>
            <div style={{ fontWeight:800, fontSize:12, color:'#f8fafc' }}>EAGLE EYE </div>
            <div style={{ fontSize:8, color:'#4f46e5', fontFamily:'monospace', letterSpacing:2 }}>AI MODERATION</div>
          </div>
        </div>

        {analyzing && (
          <div style={{ display:'flex', alignItems:'center', gap:5, background:'#1e293b', border:'1px solid #4f46e5', borderRadius:20, padding:'3px 11px' }}>
            <div style={{ width:5, height:5, borderRadius:'50%', background:'#818cf8', animation:'pulse 0.8s infinite' }} />
            <span style={{ fontSize:9, color:'#818cf8', fontFamily:'monospace' }}>AI ANALYZING</span>
          </div>
        )}
        {modQueue.map((q,i)=>(
          <div key={i} style={{ display:'flex', alignItems:'center', gap:5, background:q.status==='approved'?'#052e16':q.status==='blocked'?'#1c0000':'#1e293b', border:`1px solid ${q.status==='approved'?'#16a34a':q.status==='blocked'?'#dc2626':'#334155'}`, borderRadius:20, padding:'3px 10px', fontSize:9, fontFamily:'monospace', color:q.status==='approved'?'#4ade80':q.status==='blocked'?'#f87171':'#64748b', maxWidth:130, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', transition:'all 0.3s' }}>
            {q.status==='analyzing'?'⚡':q.status==='approved'?'✓':'✗'} {q.text.slice(0,16)}...
          </div>
        ))}

        <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>
          {violations > 0 && (
            <div style={{ display:'flex', gap:3 }}>
              {Array.from({length:VIOLATION_LIMIT}).map((_,i)=>(
                <div key={i} style={{ width:7, height:7, borderRadius:'50%', background:i<violations?'#ef4444':'#1e293b', border:'1px solid #334155', boxShadow:i<violations?'0 0 4px #ef4444':'none' }} />
              ))}
            </div>
          )}
          <div style={{ display:'flex', gap:8, alignItems:'center', background:'#0f172a', border:'1px solid #1e293b', borderRadius:20, padding:'4px 12px' }}>
            <div style={{ width:22, height:22, borderRadius:6, background:`${user.color}22`, border:`1px solid ${user.color}55`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, fontWeight:700, color:user.color, fontFamily:'monospace' }}>{user.avatar}</div>
            <span style={{ color:'#94a3b8', fontSize:11, fontWeight:600 }}>{user.name}</span>
            <span style={{ background:'#1e293b', border:'1px solid #334155', color:'#64748b', padding:'1px 5px', borderRadius:4, fontSize:8, fontFamily:'monospace', textTransform:'uppercase' }}>{user.role}</span>
          </div>
          <button onClick={onLogout} style={{ padding:'5px 11px', background:'transparent', border:'1px solid #334155', borderRadius:7, color:'#64748b', cursor:'pointer', fontSize:11 }}>Sign out</button>
        </div>
      </div>

      <div style={{ flex:1, display:'flex', overflow:'hidden' }}>
        {/* Groups sidebar */}
        <div style={{ width:200, borderRight:'1px solid #1e293b', flexShrink:0, display:'flex', flexDirection:'column', background:'#060a10' }}>
          <div style={{ padding:'10px 13px 5px', color:'#334155', fontSize:9, fontFamily:'monospace', textTransform:'uppercase', letterSpacing:1 }}>Groups</div>
          {groups.map(g=>(
            <button key={g.id} onClick={()=>setActiveGroup(g)} style={{ padding:'9px 12px', background:'none', border:'none', borderLeft:activeGroup?.id===g.id?`3px solid ${g.color}`:'3px solid transparent', cursor:'pointer', textAlign:'left', background:activeGroup?.id===g.id?'#0f172a':'transparent', transition:'all 0.2s' }}>
              <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                <span style={{ fontSize:15 }}>{g.icon}</span>
                <div>
                  <div style={{ color:activeGroup?.id===g.id?'#f8fafc':'#64748b', fontSize:11, fontWeight:600 }}>{g.name}</div>
                  {g.id===user.groupId && <div style={{ color:g.color, fontSize:8, fontFamily:'monospace' }}>your group</div>}
                </div>
              </div>
            </button>
          ))}
          {/* User skillset display */}
          {user.skillset && (
            <div style={{ marginTop:'auto', padding:'10px 12px', borderTop:'1px solid #1e293b' }}>
              <div style={{ color:'#334155', fontSize:9, fontFamily:'monospace', textTransform:'uppercase', marginBottom:5 }}>Your Context</div>
              <div style={{ color:'#475569', fontSize:9, fontFamily:'monospace', lineHeight:1.5 }}>{user.skillset.slice(0,80)}...</div>
            </div>
          )}
        </div>

        {/* Chat */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0 }}>
          {/* Channel header */}
          <div style={{ padding:'9px 16px', borderBottom:'1px solid #1e293b', display:'flex', alignItems:'center', gap:10, flexShrink:0 }}>
            <span style={{ fontSize:18 }}>{activeGroup.icon}</span>
            <div>
              <div style={{ fontWeight:700, fontSize:13 }}>{activeGroup.name}</div>
              <div style={{ color:'#475569', fontSize:10, fontFamily:'monospace' }}>AI-moderated · Semantic understanding · {messages.length} messages</div>
            </div>
            <div style={{ marginLeft:'auto', display:'flex', gap:4 }}>
              {(activeGroup.allowed||[]).slice(0,3).map(t=>(
                <span key={t} style={{ background:'#052e16', border:'1px solid #16a34a33', color:'#4ade80', padding:'2px 6px', borderRadius:4, fontSize:9, fontFamily:'monospace' }}>{t}</span>
              ))}
            </div>
          </div>

          {/* Messages */}
          <div ref={chatRef} style={{ flex:1, overflowY:'auto', padding:'12px 16px', display:'flex', flexDirection:'column' }}>
            {messages.map(msg=><ChatMessage key={msg.id} msg={msg} currentUserId={user.id} />)}
            {moderating && (
              <div style={{ display:'flex', justifyContent:'flex-end', padding:'5px 0', animation:'fadeIn 0.3s ease' }}>
                <div style={{ background:'#0f172a', border:'1px solid #334155', borderRadius:'12px 4px 12px 12px', padding:'9px 14px', display:'flex', alignItems:'center', gap:7 }}>
                  <Spinner size={14} />
                  <span style={{ color:'#6366f1', fontSize:11, fontFamily:'monospace' }}>AI semantic analysis...</span>
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div style={{ padding:'10px 16px', borderTop:'1px solid #1e293b', background:'#060a10', flexShrink:0 }}>
            {/* Test buttons */}
            <div style={{ display:'flex', gap:4, marginBottom:7, flexWrap:'wrap', alignItems:'center' }}>
              <span style={{ color:'#334155', fontSize:8, fontFamily:'monospace' }}>TEST:</span>
              {testMessages.map(({label,text})=>(
                <button key={label} onClick={()=>setInput(text)} style={{ padding:'2px 7px', background:'#0f172a', border:'1px solid #1e293b', borderRadius:20, color:'#475569', cursor:'pointer', fontSize:8, fontFamily:'monospace' }}>{label}</button>
              ))}
            </div>

            {isBanned ? (
              <div style={{ padding:'13px 16px', background:'#1c0000', border:'2px solid #dc2626', borderRadius:11, color:'#f87171', textAlign:'center', fontSize:13 }}>
                ⛔ You have been removed from this group due to repeated violations
              </div>
            ) : (
              <>
                <div style={{ display:'flex', gap:8, alignItems:'flex-end' }}>
                  <div style={{ flex:1, position:'relative' }}>
                    <textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();handleSend();}}} placeholder={`Message #${activeGroup.name.toLowerCase().replace(/ /g,'-')}... (Enter to send)`} rows={2} style={{ width:'100%', padding:'10px 13px', background:'#0f172a', border:`1px solid ${violations>=2?'#f97316':violations>=1?'#d97706':'#1e293b'}`, borderRadius:11, color:'#e2e8f0', fontSize:13, fontFamily:"'Syne',sans-serif", resize:'none', lineHeight:1.5, transition:'border-color 0.2s' }} />
                    <div style={{ position:'absolute', bottom:6, right:9, color:'#334155', fontSize:8, fontFamily:'monospace' }}>{input.length}/500</div>
                  </div>
                  <button onClick={handleSend} disabled={moderating||!input.trim()} style={{ width:42, height:42, borderRadius:11, border:'none', background:moderating?'#1e293b':'linear-gradient(135deg,#4f46e5,#7c3aed)', color:'white', cursor:moderating?'not-allowed':'pointer', fontSize:18, display:'flex', alignItems:'center', justifyContent:'center', boxShadow:moderating?'none':'0 0 16px #6366f144', flexShrink:0 }}>
                    {moderating?<Spinner />:'↑'}
                  </button>
                </div>
                {violations>0 && (
                  <div style={{ marginTop:5, display:'flex', alignItems:'center', gap:7, background:'#1c0a00', border:'1px solid #ea580c44', borderRadius:7, padding:'4px 9px' }}>
                    <span style={{ color:'#fb923c', fontSize:9, fontFamily:'monospace', flex:1 }}>⚠ Warning {violations}/{VIOLATION_LIMIT} — {VIOLATION_LIMIT-violations} more violation(s) before automatic removal</span>
                    <div style={{ display:'flex', gap:2 }}>
                      {Array.from({length:VIOLATION_LIMIT}).map((_,i)=><div key={i} style={{ width:6, height:6, borderRadius:'50%', background:i<violations?'#ef4444':'#1e293b', border:'1px solid #334155' }} />)}
                    </div>
                  </div>
                )}
              </>
            )}
            <div style={{ marginTop:4, color:'#1e293b', fontSize:8, fontFamily:'monospace', textAlign:'center' }}>Every message validated by semantic AI · Shift+Enter for new line</div>
          </div>
        </div>
      </div>

      {blockedResult && (
        <BlockedPopup result={blockedResult} violations={blockedResult._violations||0}
          onDismiss={()=>{setBlockedResult(null);setInput('');}}
          onEdit={()=>setBlockedResult(null)}
          onUseRewrite={(t)=>{setInput(t);setBlockedResult(null);}} />
      )}
      {banNotice && <BanPopup name={banNotice.name} count={banNotice.count} onClose={()=>setBanNotice(null)} />}
    </div>
  );
}

// ─── ADMIN DASHBOARD ──────────────────────────────────────────────────────────
function AdminDashboard({ user, token, onLogout }) {
  const [tab, setTab]               = useState('stats');
  const [users, setUsers]           = useState([]);
  const [groups, setGroups]         = useState([]);
  const [globalRules, setGlobalRules] = useState([]);
  const [stats, setStats]           = useState(null);
  const [editGroup, setEditGroup]   = useState(null);
  const [saving, setSaving]         = useState(false);
  const [newKeyword, setNewKeyword] = useState('');
  const [newAllowed, setNewAllowed] = useState('');
  const [ruleToast, setRuleToast]   = useState('');

  const reload = async () => {
    try {
      const [u, g, r, s] = await Promise.all([
        api('/api/admin/users',  {}, token),
        api('/api/groups',       {}, token),
        api('/api/global-rules', {}, token),
        api('/api/stats',        {}, token),
      ]);
      setUsers(u); setGroups(g); setGlobalRules(r); setStats(s);
    } catch(e) { console.error(e); }
  };
  useEffect(() => { reload(); }, []);

  const banUser   = async id => { await api(`/api/admin/users/${id}/ban`,   { method:'POST', body:{} }, token); reload(); };
  const unbanUser = async id => { await api(`/api/admin/users/${id}/unban`, { method:'POST', body:{} }, token); reload(); };

  const toggleRule = async (ruleId, currentEnabled) => {
    try {
      const updated = await api(`/api/global-rules/${ruleId}`, { method:'PUT', body:{ enabled:!currentEnabled } }, token);
      setGlobalRules(prev => prev.map(r => r.id === ruleId ? updated : r));
      setRuleToast(`"${updated.label.slice(0,30)}…" ${updated.enabled ? 'ENABLED ✅' : 'DISABLED ⚠️'}`);
      setTimeout(() => setRuleToast(''), 3500);
    } catch(e) { alert(e.message); }
  };

  const saveGroup = async () => {
    if (!editGroup) return;
    setSaving(true);
    try {
      await api(`/api/groups/${editGroup.id}`, { method:'PUT', body:editGroup }, token);
      setEditGroup(null); reload();
    } catch(e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const SEV = { CRITICAL:'#ef4444', HIGH:'#f97316', MEDIUM:'#f59e0b', LOW:'#22c55e' };
  const tabs = [['stats','📊 Stats'],['users','👥 Users'],['groups','⚙️ Groups'],['config','🛡️ Global Rules']];
  const blockRate = stats?.totalMessages ? Math.round(stats.blockedMessages/stats.totalMessages*100) : 0;
  const passRate  = stats?.totalMessages ? Math.round(stats.allowedMessages/stats.totalMessages*100) : 0;

  return (
    <div style={{ height:'100vh', display:'flex', flexDirection:'column', background:'#060a10', color:'#e2e8f0', overflow:'hidden' }}>
      {/* ── Topbar ── */}
      <div style={{ display:'flex', alignItems:'center', padding:'0 20px', height:54, borderBottom:'1px solid #1e293b', background:'#060a10ee', backdropFilter:'blur(20px)', gap:12, flexShrink:0, zIndex:20 }}>
        <div style={{ display:'flex', alignItems:'center', gap:9 }}>
          <div style={{ width:30, height:30, borderRadius:8, background:'linear-gradient(135deg,#6366f1,#8b5cf6)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, boxShadow:'0 0 16px #6366f144' }}>⚙</div>
          <div>
            <div style={{ fontWeight:800, fontSize:13, color:'#f8fafc' }}>EAGLE EYE  — Admin</div>
            <div style={{ fontSize:8, color:'#4f46e5', fontFamily:'monospace', letterSpacing:2 }}>CONTROL PANEL v3.0</div>
          </div>
        </div>
        <div style={{ display:'flex', gap:2, marginLeft:8 }}>
          {tabs.map(([t,label]) => (
            <button key={t} onClick={() => setTab(t)} style={{ padding:'6px 14px', background:tab===t?'#1e293b':'transparent', border:`1px solid ${tab===t?'#6366f1':'transparent'}`, borderRadius:8, color:tab===t?'#818cf8':'#475569', cursor:'pointer', fontSize:12, fontWeight:600, transition:'all 0.2s' }}>{label}</button>
          ))}
        </div>
        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:10 }}>
          {ruleToast && (
            <div style={{ background:'#0f172a', border:'1px solid #334155', borderRadius:8, padding:'4px 12px', fontSize:11, color:'#94a3b8', fontFamily:'monospace', animation:'fadeInUp 0.3s ease' }}>{ruleToast}</div>
          )}
          <span style={{ color:'#94a3b8', fontSize:12, fontWeight:600 }}>{user.name}</span>
          <span style={{ background:'linear-gradient(135deg,#312e81,#4c1d95)', border:'1px solid #6366f1', color:'#818cf8', padding:'2px 8px', borderRadius:6, fontSize:9, fontFamily:'monospace' }}>ADMIN</span>
          <button onClick={onLogout} style={{ padding:'5px 11px', background:'transparent', border:'1px solid #334155', borderRadius:7, color:'#64748b', cursor:'pointer', fontSize:11 }}>Sign out</button>
        </div>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:24 }}>

        {/* ════════════ STATS TAB ════════════ */}
        {tab==='stats' && stats && (
          <div style={{ animation:'fadeInUp 0.4s ease' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
              <div>
                <div style={{ color:'#f8fafc', fontWeight:800, fontSize:20 }}>Platform Analytics</div>
                <div style={{ color:'#475569', fontSize:11, marginTop:2, fontFamily:'monospace' }}>Live data from all groups · {stats.recentActivity?.length||0} events tracked</div>
              </div>
              <button onClick={reload} style={{ padding:'6px 14px', background:'#1e293b', border:'1px solid #334155', borderRadius:8, color:'#64748b', cursor:'pointer', fontSize:11 }}>↻ Refresh</button>
            </div>

            {/* KPI row */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:10, marginBottom:20 }}>
              {[
                { label:'Total Messages', val:stats.totalMessages,    icon:'💬', color:'#6366f1', sub:'all time' },
                { label:'Allowed',        val:stats.allowedMessages,  icon:'✅', color:'#22c55e', sub:`${passRate}% pass rate` },
                { label:'Blocked',        val:stats.blockedMessages,  icon:'🚫', color:'#ef4444', sub:`${blockRate}% block rate` },
                { label:'Total Users',    val:stats.totalUsers,       icon:'👥', color:'#8b5cf6', sub:`${stats.bannedUsers} banned` },
                { label:'Groups',         val:stats.activeGroups,     icon:'🏫', color:'#06b6d4', sub:'learning groups' },
                { label:'Active Rules',   val:stats.enabledRules||0,  icon:'🛡️', color:'#f59e0b', sub:`${stats.disabledRules||0} disabled` },
              ].map(c => (
                <div key={c.label} style={{ background:'#0d1117', border:`1px solid ${c.color}22`, borderRadius:14, padding:'16px 16px 12px', position:'relative', overflow:'hidden' }}>
                  <div style={{ position:'absolute', top:12, right:14, fontSize:20, opacity:0.18 }}>{c.icon}</div>
                  <div style={{ color:c.color, fontSize:26, fontWeight:800, fontFamily:'monospace', lineHeight:1 }}>{c.val}</div>
                  <div style={{ color:'#94a3b8', fontSize:11, fontWeight:600, marginTop:5 }}>{c.label}</div>
                  <div style={{ color:'#475569', fontSize:9, fontFamily:'monospace', marginTop:2 }}>{c.sub}</div>
                </div>
              ))}
            </div>

            {/* Pass/Block visual gauge */}
            <div style={{ background:'#0d1117', border:'1px solid #1e293b', borderRadius:14, padding:'18px 20px', marginBottom:16 }}>
              <div style={{ color:'#94a3b8', fontWeight:700, fontSize:12, marginBottom:12 }}>📊 Overall Message Health</div>
              <div style={{ display:'flex', height:20, borderRadius:10, overflow:'hidden', background:'#0f172a' }}>
                <div style={{ width:`${passRate}%`, background:'linear-gradient(90deg,#059669,#22c55e)', transition:'width 1s ease', display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, color:'white', fontWeight:700, fontFamily:'monospace' }}>
                  {passRate > 10 ? `${passRate}% SAFE` : ''}
                </div>
                <div style={{ width:`${blockRate}%`, background:'linear-gradient(90deg,#dc2626,#ef4444)', transition:'width 1s ease', display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, color:'white', fontWeight:700, fontFamily:'monospace' }}>
                  {blockRate > 10 ? `${blockRate}% BLOCKED` : ''}
                </div>
              </div>
              <div style={{ display:'flex', gap:20, marginTop:8 }}>
                <span style={{ color:'#22c55e', fontSize:10, fontFamily:'monospace' }}>■ Allowed: {stats.allowedMessages}</span>
                <span style={{ color:'#ef4444', fontSize:10, fontFamily:'monospace' }}>■ Blocked: {stats.blockedMessages}</span>
              </div>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:16 }}>
              {/* Violations by category */}
              <div style={{ background:'#0d1117', border:'1px solid #1e293b', borderRadius:14, padding:20 }}>
                <div style={{ color:'#94a3b8', fontWeight:700, fontSize:13, marginBottom:14 }}>🚨 Violations by Category</div>
                {!Object.keys(stats.violationsByCategory||{}).length
                  ? <div style={{ color:'#334155', fontSize:12, fontFamily:'monospace', padding:'20px 0', textAlign:'center' }}>No violations yet — start sending messages</div>
                  : Object.entries(stats.violationsByCategory).sort((a,b)=>b[1]-a[1]).map(([cat, count]) => {
                      const max = Math.max(...Object.values(stats.violationsByCategory));
                      const pct = Math.round(count/max*100);
                      const rule = globalRules.find(r => r.id === cat);
                      return (
                        <div key={cat} style={{ marginBottom:11 }}>
                          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:5, alignItems:'center' }}>
                            <span style={{ color:'#94a3b8', fontSize:11, display:'flex', alignItems:'center', gap:5 }}>
                              <span>{rule?.icon||'•'}</span>{rule?.label?.slice(0,28)||cat}
                            </span>
                            <span style={{ color:'#ef4444', fontSize:12, fontFamily:'monospace', fontWeight:700, background:'#1c0000', border:'1px solid #dc262633', padding:'1px 7px', borderRadius:5 }}>{count}</span>
                          </div>
                          <div style={{ background:'#0f172a', borderRadius:6, height:7, overflow:'hidden' }}>
                            <div style={{ height:'100%', width:`${pct}%`, background:`linear-gradient(90deg,${SEV[rule?.severity]||'#6366f1'},${SEV[rule?.severity]||'#6366f1'}88)`, borderRadius:6, transition:'width 0.8s ease', boxShadow:`0 0 8px ${SEV[rule?.severity]||'#6366f1'}44` }} />
                          </div>
                        </div>
                      );
                    })
                }
              </div>

              {/* Hourly heatmap */}
              <div style={{ background:'#0d1117', border:'1px solid #1e293b', borderRadius:14, padding:20 }}>
                <div style={{ color:'#94a3b8', fontWeight:700, fontSize:13, marginBottom:14 }}>🕐 Activity by Hour (24h)</div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(12,1fr)', gap:5 }}>
                  {(stats.hourlyActivity||new Array(24).fill(0)).map((count, hour) => {
                    const max = Math.max(...(stats.hourlyActivity||[1]), 1);
                    const intensity = count / max;
                    const bg = count === 0 ? '#0f172a' : `rgba(99,102,241,${0.12 + intensity * 0.88})`;
                    const isCurrentHour = new Date().getHours() === hour;
                    return (
                      <div key={hour} title={`${String(hour).padStart(2,'0')}:00 — ${count} messages`}
                        style={{ background:bg, borderRadius:6, aspectRatio:'1', display:'flex', alignItems:'center', justifyContent:'center', fontSize:8, color: intensity > 0.5 ? '#c7d2fe' : '#334155', cursor:'default', border:`1px solid ${isCurrentHour?'#6366f1':'#1e293b'}`, transition:'background 0.4s', position:'relative' }}>
                        {hour}
                      </div>
                    );
                  })}
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:10 }}>
                  <div style={{ display:'flex', gap:3 }}>
                    {[0.1,0.3,0.5,0.7,0.9].map(v => <div key={v} style={{ width:10, height:10, borderRadius:3, background:`rgba(99,102,241,${v})` }} />)}
                  </div>
                  <span style={{ color:'#334155', fontSize:9, fontFamily:'monospace' }}>Low → High activity  ·  Outlined = current hour</span>
                </div>
              </div>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:16 }}>
              {/* Violations by group */}
              <div style={{ background:'#0d1117', border:'1px solid #1e293b', borderRadius:14, padding:20 }}>
                <div style={{ color:'#94a3b8', fontWeight:700, fontSize:13, marginBottom:14 }}>🏫 Violations by Group</div>
                {!Object.keys(stats.violationsByGroup||{}).length
                  ? <div style={{ color:'#334155', fontSize:12, fontFamily:'monospace', padding:'20px 0', textAlign:'center' }}>No data yet</div>
                  : Object.entries(stats.violationsByGroup).sort((a,b)=>b[1]-a[1]).map(([gid, count]) => {
                      const g = groups.find(x => x.id === gid);
                      const total = Object.values(stats.violationsByGroup).reduce((a,b)=>a+b,0);
                      const pct = Math.round(count/total*100);
                      return (
                        <div key={gid} style={{ marginBottom:11 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:5 }}>
                            <span style={{ fontSize:16 }}>{g?.icon||'🏫'}</span>
                            <span style={{ color:'#94a3b8', fontSize:11, flex:1 }}>{g?.name||gid}</span>
                            <span style={{ color:'#f87171', fontSize:11, fontFamily:'monospace', fontWeight:700 }}>{count} <span style={{ color:'#475569', fontSize:9 }}>({pct}%)</span></span>
                          </div>
                          <div style={{ background:'#0f172a', borderRadius:6, height:6, overflow:'hidden' }}>
                            <div style={{ height:'100%', width:`${pct}%`, background:`linear-gradient(90deg,${g?.color||'#6366f1'},${g?.color||'#6366f1'}88)`, borderRadius:6, transition:'width 0.8s ease' }} />
                          </div>
                        </div>
                      );
                    })
                }
              </div>

              {/* Top violators */}
              <div style={{ background:'#0d1117', border:'1px solid #1e293b', borderRadius:14, padding:20 }}>
                <div style={{ color:'#94a3b8', fontWeight:700, fontSize:13, marginBottom:14 }}>⚠️ Top Violators</div>
                {!stats.topViolators?.length
                  ? <div style={{ color:'#334155', fontSize:12, fontFamily:'monospace', padding:'20px 0', textAlign:'center' }}>No violators yet</div>
                  : stats.topViolators.map((v, i) => (
                      <div key={v.userId} style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10, padding:'9px 12px', background:'#0f172a', borderRadius:10 }}>
                        <span style={{ color: i===0?'#f59e0b':i===1?'#94a3b8':i===2?'#b45309':'#475569', fontFamily:'monospace', fontSize:12, fontWeight:700, width:20 }}>#{i+1}</span>
                        <div style={{ flex:1 }}>
                          <div style={{ color:'#e2e8f0', fontSize:12, fontWeight:600 }}>{v.name}</div>
                          {v.banned && <span style={{ background:'#1c0000', border:'1px solid #dc262633', color:'#f87171', padding:'1px 5px', borderRadius:3, fontSize:8, fontFamily:'monospace' }}>BANNED</span>}
                        </div>
                        <div style={{ textAlign:'right' }}>
                          <div style={{ color:'#f97316', fontSize:16, fontFamily:'monospace', fontWeight:800 }}>{v.count}</div>
                          <div style={{ color:'#475569', fontSize:9, fontFamily:'monospace' }}>violations</div>
                        </div>
                      </div>
                    ))
                }
              </div>
            </div>

            {/* Live activity feed */}
            <div style={{ background:'#0d1117', border:'1px solid #1e293b', borderRadius:14, padding:20 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
                <div style={{ color:'#94a3b8', fontWeight:700, fontSize:13 }}>📡 Live Activity Feed</div>
                <div style={{ display:'flex', gap:4, alignItems:'center' }}>
                  <div style={{ width:6, height:6, borderRadius:'50%', background:'#22c55e', boxShadow:'0 0 6px #22c55e', animation:'pulse 1.5s infinite' }} />
                  <span style={{ color:'#22c55e', fontSize:9, fontFamily:'monospace' }}>LIVE</span>
                </div>
              </div>
              {!stats.recentActivity?.length
                ? <div style={{ color:'#334155', fontSize:12, fontFamily:'monospace', padding:'20px 0', textAlign:'center' }}>No activity yet — send messages to see real-time data here</div>
                : (
                  <div>
                    <div style={{ display:'grid', gridTemplateColumns:'28px 110px 1fr 120px 80px 60px', gap:'0 10px', padding:'5px 8px', marginBottom:6 }}>
                      {['','User','Category / Outcome','Group','Toxicity','Time'].map(h => (
                        <div key={h} style={{ color:'#334155', fontSize:9, fontFamily:'monospace', textTransform:'uppercase' }}>{h}</div>
                      ))}
                    </div>
                    {stats.recentActivity.slice(0,15).map((ev, i) => {
                      const g = groups.find(x => x.id === ev.groupId);
                      const cfg = TOXICITY_COLORS[ev.toxicity_level] || TOXICITY_COLORS.SAFE;
                      const rule = globalRules.find(r => r.id === ev.violation_category);
                      return (
                        <div key={i} style={{ display:'grid', gridTemplateColumns:'28px 110px 1fr 120px 80px 60px', gap:'0 10px', padding:'7px 8px', borderRadius:8, background:i%2===0?'#0f172a':'transparent', alignItems:'center' }}>
                          <span style={{ fontSize:14 }}>{ev.allowed?'✅':'🚫'}</span>
                          <span style={{ color:'#94a3b8', fontSize:11, fontFamily:'monospace', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{ev.userName}</span>
                          <span style={{ color:'#64748b', fontSize:10, fontFamily:'monospace', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                            {ev.allowed ? '— allowed through' : (rule?.label?.slice(0,35)||ev.violation_category||'blocked')}
                          </span>
                          <span style={{ color:'#475569', fontSize:10, display:'flex', alignItems:'center', gap:4 }}>
                            <span>{g?.icon||'🏫'}</span>
                            <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{g?.name?.split(' ')[0]||ev.groupId}</span>
                          </span>
                          <span style={{ background:cfg.bg, border:`1px solid ${cfg.border}`, color:cfg.text, padding:'2px 6px', borderRadius:5, fontSize:9, fontFamily:'monospace', textAlign:'center' }}>{ev.toxicity_level}</span>
                          <span style={{ color:'#334155', fontSize:9, fontFamily:'monospace' }}>{new Date(ev.timestamp).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>
                        </div>
                      );
                    })}
                  </div>
                )
              }
            </div>
          </div>
        )}

        {/* ════════════ USERS TAB ════════════ */}
        {tab==='users' && (
          <div style={{ animation:'fadeInUp 0.4s ease' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
              <div style={{ color:'#f8fafc', fontWeight:700, fontSize:16 }}>User Management</div>
              <div style={{ display:'flex', gap:10, fontSize:11, fontFamily:'monospace' }}>
                <span style={{ color:'#22c55e' }}>Active: {users.filter(u=>!u.banned).length}</span>
                <span style={{ color:'#ef4444' }}>Banned: {users.filter(u=>u.banned).length}</span>
                <span style={{ color:'#64748b' }}>Total: {users.length}</span>
              </div>
            </div>
            <div style={{ display:'grid', gap:10 }}>
              {users.map(u => (
                <div key={u.id} style={{ background:'#0d1117', border:`1px solid ${u.banned?'#7f1d1d':'#1e293b'}`, borderRadius:12, padding:'14px 18px', display:'flex', alignItems:'center', gap:14 }}>
                  <div style={{ width:40, height:40, borderRadius:10, background:`${u.color}22`, border:`1px solid ${u.color}55`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:700, color:u.color, fontFamily:'monospace', flexShrink:0 }}>{u.avatar}</div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3 }}>
                      <span style={{ color:'#f8fafc', fontWeight:700, fontSize:13 }}>{u.name}</span>
                      <span style={{ background:u.role==='admin'?'#312e81':u.role==='mentor'?'#1e3a5f':'#1e293b', border:`1px solid ${u.role==='admin'?'#6366f1':u.role==='mentor'?'#1d4ed8':'#334155'}`, color:u.role==='admin'?'#818cf8':u.role==='mentor'?'#60a5fa':'#64748b', padding:'1px 6px', borderRadius:5, fontSize:9, fontFamily:'monospace' }}>{u.role.toUpperCase()}</span>
                      {u.banned && <span style={{ background:'#1c0000', border:'1px solid #dc2626', color:'#f87171', padding:'1px 6px', borderRadius:5, fontSize:9, fontFamily:'monospace' }}>BANNED</span>}
                    </div>
                    <div style={{ color:'#475569', fontSize:11, fontFamily:'monospace' }}>{u.email}</div>
                    {u.skillset && <div style={{ color:'#334155', fontSize:10, fontFamily:'monospace', marginTop:2 }}>🎓 {u.skillset.slice(0,70)}{u.skillset.length>70?'...':''}</div>}
                    {u.groupId && <div style={{ color:'#334155', fontSize:10, fontFamily:'monospace' }}>📍 {groups.find(g=>g.id===u.groupId)?.name||u.groupId}</div>}
                  </div>
                  <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                    {u.violations > 0 && (
                      <div style={{ background:'#1c0a00', border:'1px solid #ea580c44', borderRadius:8, padding:'4px 10px', display:'flex', gap:4, alignItems:'center' }}>
                        {Array.from({length:VIOLATION_LIMIT}).map((_,i) => (
                          <div key={i} style={{ width:7, height:7, borderRadius:'50%', background:i<u.violations?'#ef4444':'#1e293b', border:'1px solid #334155', boxShadow:i<u.violations?'0 0 4px #ef4444':'none' }} />
                        ))}
                        <span style={{ color:'#fb923c', fontSize:9, fontFamily:'monospace', marginLeft:4 }}>{u.violations}x</span>
                      </div>
                    )}
                    {u.role !== 'admin' && (
                      u.banned
                        ? <button onClick={() => unbanUser(u.id)} style={{ padding:'6px 14px', background:'#052e16', border:'1px solid #16a34a', borderRadius:8, color:'#4ade80', cursor:'pointer', fontSize:11, fontWeight:600 }}>🔓 Unban</button>
                        : <button onClick={() => banUser(u.id)}   style={{ padding:'6px 14px', background:'#1c0000', border:'1px solid #dc2626', borderRadius:8, color:'#f87171', cursor:'pointer', fontSize:11, fontWeight:600 }}>⛔ Ban</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ════════════ GROUPS TAB ════════════ */}
        {tab==='groups' && (
          <div style={{ display:'grid', gridTemplateColumns:editGroup?'1fr 1fr':'1fr', gap:16, animation:'fadeInUp 0.4s ease' }}>
            <div>
              <div style={{ color:'#f8fafc', fontWeight:700, fontSize:16, marginBottom:16 }}>Learning Groups</div>
              {groups.map(g => (
                <div key={g.id} style={{ background:'#0d1117', border:`1px solid ${editGroup?.id===g.id?g.color+'88':'#1e293b'}`, borderRadius:12, padding:'14px 16px', marginBottom:10 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
                    <span style={{ fontSize:22 }}>{g.icon}</span>
                    <div style={{ flex:1 }}>
                      <div style={{ color:'#f8fafc', fontWeight:700, fontSize:13 }}>{g.name}</div>
                      <div style={{ color:'#475569', fontSize:10, fontFamily:'monospace' }}>{g.description?.slice(0,60)}...</div>
                    </div>
                    <button onClick={() => setEditGroup(editGroup?.id===g.id?null:{...g})} style={{ padding:'5px 12px', background:editGroup?.id===g.id?'#312e81':'#1e293b', border:`1px solid ${editGroup?.id===g.id?'#6366f1':'#334155'}`, borderRadius:7, color:editGroup?.id===g.id?'#818cf8':'#64748b', cursor:'pointer', fontSize:11 }}>
                      {editGroup?.id===g.id?'✕ Close':'✏️ Edit'}
                    </button>
                  </div>
                  <div style={{ display:'flex', gap:8 }}>
                    <div style={{ flex:1 }}>
                      <div style={{ color:'#334155', fontSize:9, fontFamily:'monospace', textTransform:'uppercase', marginBottom:4 }}>Disallowed</div>
                      <div style={{ display:'flex', flexWrap:'wrap', gap:3 }}>
                        {(g.disallowed||[]).slice(0,5).map(k => <span key={k} style={{ background:'#1c1917', border:'1px solid #dc262633', color:'#f87171', padding:'1px 7px', borderRadius:20, fontSize:9, fontFamily:'monospace' }}>{k}</span>)}
                        {(g.disallowed||[]).length>5 && <span style={{ color:'#475569', fontSize:9 }}>+{g.disallowed.length-5}</span>}
                      </div>
                    </div>
                    <div style={{ flex:1 }}>
                      <div style={{ color:'#334155', fontSize:9, fontFamily:'monospace', textTransform:'uppercase', marginBottom:4 }}>Allowed</div>
                      <div style={{ display:'flex', flexWrap:'wrap', gap:3 }}>
                        {(g.allowed||[]).slice(0,5).map(k => <span key={k} style={{ background:'#052e16', border:'1px solid #16a34a33', color:'#4ade80', padding:'1px 7px', borderRadius:20, fontSize:9, fontFamily:'monospace' }}>{k}</span>)}
                        {(g.allowed||[]).length>5 && <span style={{ color:'#475569', fontSize:9 }}>+{g.allowed.length-5}</span>}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {editGroup && (
              <div style={{ background:'#0d1117', border:'1px solid #1e293b', borderRadius:12, padding:20, height:'fit-content', position:'sticky', top:0 }}>
                <div style={{ color:'#f8fafc', fontWeight:700, fontSize:14, marginBottom:16 }}>✏️ Editing: {editGroup.name}</div>
                <div style={{ marginBottom:12 }}>
                  <label style={{ color:'#64748b', fontSize:10, fontFamily:'monospace', textTransform:'uppercase', display:'block', marginBottom:5 }}>Semantic Context (AI uses this for judgment)</label>
                  <textarea value={editGroup.semanticContext||''} onChange={e=>setEditGroup(p=>({...p,semanticContext:e.target.value}))} rows={3} style={{ width:'100%', padding:'9px 11px', background:'#0f172a', border:'1px solid #334155', borderRadius:8, color:'#e2e8f0', fontSize:11, fontFamily:'monospace', resize:'none', outline:'none', lineHeight:1.6 }} />
                </div>
                <div style={{ marginBottom:12 }}>
                  <label style={{ color:'#64748b', fontSize:10, fontFamily:'monospace', textTransform:'uppercase', display:'block', marginBottom:5 }}>🚫 Disallowed Topics</label>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:4, marginBottom:7, minHeight:28 }}>
                    {(editGroup.disallowed||[]).map(k => (
                      <span key={k} style={{ background:'#1c1917', border:'1px solid #dc262644', color:'#f87171', padding:'2px 8px', borderRadius:20, fontSize:10, fontFamily:'monospace', display:'flex', alignItems:'center', gap:4 }}>
                        {k}<button onClick={()=>setEditGroup(p=>({...p,disallowed:p.disallowed.filter(d=>d!==k)}))} style={{ background:'none', border:'none', color:'#ef4444', cursor:'pointer', padding:0, lineHeight:1, fontSize:14 }}>×</button>
                      </span>
                    ))}
                  </div>
                  <div style={{ display:'flex', gap:6 }}>
                    <input value={newKeyword} onChange={e=>setNewKeyword(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&newKeyword.trim()){setEditGroup(p=>({...p,disallowed:[...(p.disallowed||[]),newKeyword.trim()]}));setNewKeyword('');}}} placeholder="Add topic + Enter" style={{ flex:1, padding:'7px 10px', background:'#0f172a', border:'1px solid #334155', borderRadius:7, color:'#e2e8f0', fontSize:11, fontFamily:'monospace', outline:'none' }} />
                    <button onClick={()=>{if(newKeyword.trim()){setEditGroup(p=>({...p,disallowed:[...(p.disallowed||[]),newKeyword.trim()]}));setNewKeyword('');}}} style={{ padding:'7px 13px', background:'#dc2626', border:'none', borderRadius:7, color:'white', cursor:'pointer', fontWeight:700 }}>+</button>
                  </div>
                </div>
                <div style={{ marginBottom:18 }}>
                  <label style={{ color:'#64748b', fontSize:10, fontFamily:'monospace', textTransform:'uppercase', display:'block', marginBottom:5 }}>✅ Allowed Topics</label>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:4, marginBottom:7, minHeight:28 }}>
                    {(editGroup.allowed||[]).map(k => (
                      <span key={k} style={{ background:'#052e16', border:'1px solid #16a34a44', color:'#4ade80', padding:'2px 8px', borderRadius:20, fontSize:10, fontFamily:'monospace', display:'flex', alignItems:'center', gap:4 }}>
                        {k}<button onClick={()=>setEditGroup(p=>({...p,allowed:p.allowed.filter(a=>a!==k)}))} style={{ background:'none', border:'none', color:'#4ade80', cursor:'pointer', padding:0, lineHeight:1, fontSize:14 }}>×</button>
                      </span>
                    ))}
                  </div>
                  <div style={{ display:'flex', gap:6 }}>
                    <input value={newAllowed} onChange={e=>setNewAllowed(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&newAllowed.trim()){setEditGroup(p=>({...p,allowed:[...(p.allowed||[]),newAllowed.trim()]}));setNewAllowed('');}}} placeholder="Add topic + Enter" style={{ flex:1, padding:'7px 10px', background:'#0f172a', border:'1px solid #334155', borderRadius:7, color:'#e2e8f0', fontSize:11, fontFamily:'monospace', outline:'none' }} />
                    <button onClick={()=>{if(newAllowed.trim()){setEditGroup(p=>({...p,allowed:[...(p.allowed||[]),newAllowed.trim()]}));setNewAllowed('');}}} style={{ padding:'7px 13px', background:'#16a34a', border:'none', borderRadius:7, color:'white', cursor:'pointer', fontWeight:700 }}>+</button>
                  </div>
                </div>
                <button onClick={saveGroup} disabled={saving} style={{ width:'100%', padding:'11px', background:saving?'#1e293b':'linear-gradient(135deg,#4f46e5,#7c3aed)', border:'none', borderRadius:9, color:'white', cursor:saving?'not-allowed':'pointer', fontFamily:"'Syne',sans-serif", fontSize:13, fontWeight:700 }}>
                  {saving ? <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:8}}><Spinner />Saving…</div> : '💾 Save Changes'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ════════════ GLOBAL RULES TAB ════════════ */}
        {tab==='config' && (
          <div style={{ maxWidth:780, animation:'fadeInUp 0.4s ease' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
              <div>
                <div style={{ color:'#f8fafc', fontWeight:800, fontSize:18 }}>Global Moderation Rules</div>
                <div style={{ color:'#475569', fontSize:12, marginTop:3 }}>Toggle any rule on or off — takes effect immediately for all groups and users</div>
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <span style={{ background:'#052e16', border:'1px solid #16a34a44', color:'#4ade80', padding:'5px 12px', borderRadius:8, fontSize:11, fontFamily:'monospace' }}>
                  ✅ {globalRules.filter(r=>r.enabled).length} active
                </span>
                <span style={{ background:'#1c0a00', border:'1px solid #ea580c44', color:'#fb923c', padding:'5px 12px', borderRadius:8, fontSize:11, fontFamily:'monospace' }}>
                  ⚠️ {globalRules.filter(r=>!r.enabled).length} off
                </span>
              </div>
            </div>

            {/* Warning when rules disabled */}
            {globalRules.some(r => !r.enabled) && (
              <div style={{ background:'#1c0a00', border:'1px solid #f9731688', borderRadius:12, padding:'12px 18px', marginBottom:16, display:'flex', gap:12, alignItems:'flex-start' }}>
                <span style={{ fontSize:20, flexShrink:0 }}>⚠️</span>
                <div>
                  <div style={{ color:'#fb923c', fontWeight:700, fontSize:13 }}>Some moderation rules are currently disabled</div>
                  <div style={{ color:'#92400e', fontSize:11, marginTop:3, lineHeight:1.6 }}>
                    Messages that would normally be blocked by <strong>disabled rules</strong> will pass through unfiltered. Disabled rules: <span style={{ color:'#fb923c' }}>{globalRules.filter(r=>!r.enabled).map(r=>r.label.split(' ')[0]).join(', ')}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Severity legend */}
            <div style={{ display:'flex', gap:10, marginBottom:16, flexWrap:'wrap' }}>
              {Object.entries(SEV).map(([sev, color]) => (
                <span key={sev} style={{ background:`${color}15`, border:`1px solid ${color}44`, color, padding:'3px 10px', borderRadius:6, fontSize:10, fontFamily:'monospace' }}>
                  ● {sev}
                </span>
              ))}
              <span style={{ color:'#334155', fontSize:10, fontFamily:'monospace', alignSelf:'center', marginLeft:4 }}>— severity levels (affects warning display to users)</span>
            </div>

            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {globalRules.map(rule => {
                const sevColor = SEV[rule.severity] || '#64748b';
                const violationCount = stats?.violationsByCategory?.[rule.id] || 0;
                return (
                  <div key={rule.id} style={{ background:'#0d1117', border:`1px solid ${rule.enabled?'#1e293b':'#7c2d1288'}`, borderRadius:13, padding:'14px 20px', display:'flex', alignItems:'center', gap:16, transition:'all 0.35s', opacity:rule.enabled?1:0.6 }}>
                    <span style={{ fontSize:24, flexShrink:0 }}>{rule.icon}</span>

                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:5, flexWrap:'wrap' }}>
                        <span style={{ color:rule.enabled?'#f8fafc':'#64748b', fontWeight:700, fontSize:13, transition:'color 0.3s' }}>{rule.label}</span>
                        <span style={{ background:`${sevColor}18`, border:`1px solid ${sevColor}44`, color:sevColor, padding:'1px 7px', borderRadius:5, fontSize:9, fontFamily:'monospace', fontWeight:700 }}>{rule.severity}</span>
                        <span style={{ background:'#1e293b', border:'1px solid #334155', color:'#475569', padding:'1px 7px', borderRadius:5, fontSize:9, fontFamily:'monospace' }}>{rule.method}</span>
                        {violationCount > 0 && (
                          <span style={{ background:'#1c0000', border:'1px solid #dc262633', color:'#f87171', padding:'1px 7px', borderRadius:5, fontSize:9, fontFamily:'monospace' }}>
                            {violationCount} blocked
                          </span>
                        )}
                      </div>
                      <div style={{ color:'#475569', fontSize:11, lineHeight:1.55 }}>{rule.description}</div>
                    </div>

                    {/* Toggle switch */}
                    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4, flexShrink:0 }}>
                      <div onClick={() => toggleRule(rule.id, rule.enabled)}
                        style={{ width:52, height:28, borderRadius:14, background:rule.enabled?'#16a34a':'#1e293b', position:'relative', cursor:'pointer', transition:'background 0.35s', boxShadow:rule.enabled?'0 0 14px #16a34a55':'inset 0 1px 4px rgba(0,0,0,0.5)', border:`1px solid ${rule.enabled?'#16a34a':'#334155'}` }}>
                        <div style={{ position:'absolute', top:4, left:rule.enabled?26:4, width:18, height:18, borderRadius:'50%', background:rule.enabled?'white':'#64748b', transition:'left 0.35s, background 0.35s', boxShadow:'0 2px 6px rgba(0,0,0,0.4)' }} />
                      </div>
                      <span style={{ color:rule.enabled?'#4ade80':'#64748b', fontSize:9, fontFamily:'monospace', fontWeight:700, letterSpacing:1, transition:'color 0.3s' }}>
                        {rule.enabled?'ON':'OFF'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Philosophy */}
            <div style={{ background:'#0d1117', border:'1px solid #1e293b', borderRadius:13, padding:20, marginTop:18 }}>
              <div style={{ color:'#94a3b8', fontSize:13, fontWeight:700, marginBottom:12 }}>🤖 AI Moderation Philosophy</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                {[
                  ['🧠','Semantic understanding','No keyword blacklists — AI understands meaning, intent, and context'],
                  ['⚡','Agentic context','User skillset + group scope pre-analysed by AI before every check'],
                  ['🔗','Cross-domain intelligence','Python in Java group for API integration = allowed'],
                  ['💬','Educational feedback','Every block shows polite reason + AI rewrite suggestion'],
                  ['📈','Progressive warnings','3 violations → auto-remove, admin can unban anytime'],
                  ['🎛️','Admin toggle control','Any rule toggled here takes effect platform-wide immediately'],
                ].map(([icon,title,desc]) => (
                  <div key={title} style={{ display:'flex', gap:10, padding:'10px 12px', background:'#0f172a', borderRadius:9 }}>
                    <span style={{ fontSize:16, flexShrink:0 }}>{icon}</span>
                    <div>
                      <div style={{ color:'#94a3b8', fontSize:11, fontWeight:700, marginBottom:2 }}>{title}</div>
                      <div style={{ color:'#475569', fontSize:10, lineHeight:1.55 }}>{desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


// ─── ROOT APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [hasApiKey, setHasApiKey]   = useState(false);
  const [token, setToken]           = useState(() => sessionStorage.getItem('wg_token') || '');
  const [user, setUser]             = useState(null);
  const [groups, setGroups]         = useState([]);
  const [loading, setLoading]       = useState(true);

  useEffect(()=>{
    (async ()=>{
      try {
        const s = await api('/api/key-status');
        setHasApiKey(s.hasKey);
        if (token) {
          const u = await api('/api/auth/me', {}, token);
          const gs = await api('/api/groups', {}, token);
          setUser(u); setGroups(gs);
        }
      } catch { setToken(''); sessionStorage.removeItem('wg_token'); }
      finally { setLoading(false); }
    })();
  }, []);

  const handleLogin = (t, u) => {
    setToken(t); setUser(u);
    sessionStorage.setItem('wg_token', t);
  };
  const handleLogout = () => {
    api('/api/auth/logout', { method:'POST' }, token).catch(()=>{});
    setToken(''); setUser(null);
    sessionStorage.removeItem('wg_token');
  };
  const handleSetupDone = (updatedUser) => setUser(updatedUser);

  if (loading) return (
    <div style={{ height:'100vh', background:'#060a10', display:'flex', alignItems:'center', justifyContent:'center', gap:12, color:'#475569', fontFamily:'monospace' }}>
      <Spinner size={20} /> Loading EAGLE EYE ...
    </div>
  );

  return (
    <>
      <style>{FONTS + BASE_STYLES}</style>
      {!hasApiKey && <ApiKeyScreen onDone={()=>setHasApiKey(true)} />}
      {hasApiKey && !token && <LoginScreen onLogin={handleLogin} />}
      {hasApiKey && token && user && user.role === 'admin' && <AdminDashboard user={user} token={token} onLogout={handleLogout} />}
      {hasApiKey && token && user && user.role !== 'admin' && (!user.groupId) && <UserSetupScreen user={user} token={token} groups={groups.length?groups:[]} onDone={handleSetupDone} />}
      {hasApiKey && token && user && user.role !== 'admin' && user.groupId && <LearnerChat user={user} token={token} onLogout={handleLogout} />}
    </>
  );
}
