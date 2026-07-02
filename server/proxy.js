
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import { readFileSync, existsSync } from 'fs';
import { randomBytes, createHash } from 'crypto';

const app = express();
const PORT = 3001;
app.use(cors());
app.use(express.json({ limit: '10mb' }));

let API_KEY = '';
const envPath = new URL('../.env', import.meta.url).pathname;
if (existsSync(envPath)) {
  const env = readFileSync(envPath, 'utf-8');
  const m = env.match(/GROQ_API_KEY\s*=\s*(.+)/);
  if (m) { API_KEY = m[1].trim().replace(/['"]/g, ''); console.log('✅ Groq key loaded from .env'); }
}

function hash(str) { return createHash('sha256').update(str + 'wele_salt').digest('hex'); }
function genToken() { return randomBytes(32).toString('hex'); }


const DB = {
  users: [
    { id:'admin1', name:'Admin',       email:'admin@wele.com',  password:hash('admin123'), role:'admin',   avatar:'AD', color:'#6366f1', banned:false, skillset:'', groupId:'' },
    { id:'user1',  name:'Alex Rivera', email:'alex@wele.com',   password:hash('user123'),  role:'learner', avatar:'AR', color:'#8b5cf6', banned:false, skillset:'', groupId:'' },
    { id:'user2',  name:'Priya Nair',  email:'priya@wele.com',  password:hash('user123'),  role:'mentor',  avatar:'PN', color:'#06b6d4', banned:false, skillset:'', groupId:'' },
    { id:'user3',  name:'Sam Chen',    email:'sam@wele.com',    password:hash('user123'),  role:'learner', avatar:'SC', color:'#10b981', banned:false, skillset:'', groupId:'' },
  ],
  groups: [
    { id:'fullstack-java', name:'Full Stack Java Development', icon:'☕', color:'#f59e0b',
      description:'Enterprise full-stack web development using the Java ecosystem including Spring Boot, REST APIs, and frontend frameworks',
      semanticContext:'Java programming, Spring Boot framework, Spring MVC, REST APIs, microservices, Hibernate ORM, JPA, Maven, Gradle, JUnit testing, Angular, React with Java backend, MySQL, PostgreSQL, Tomcat, JWT authentication, Docker with Java',
      disallowed:['.NET','C#','Quantum Computing','DevOps pipelines','QA automation','Ruby','PHP'],
      allowed:['Java','Spring Boot','Spring MVC','React','Angular','MySQL','Hibernate','Maven','REST API','JUnit','Microservices','JWT','PostgreSQL'] },
    { id:'data-science', name:'Data Science & ML', icon:'🧠', color:'#8b5cf6',
      description:'Data analysis, machine learning algorithms, deep learning, statistical modelling and AI research',
      semanticContext:'Python for data science, pandas dataframes, numpy arrays, scikit-learn machine learning, TensorFlow deep learning, PyTorch neural networks, matplotlib visualization, seaborn charts, Jupyter notebooks, statistics, regression, classification, clustering, NLP natural language processing, computer vision, feature engineering',
      disallowed:['Blockchain','Game Dev','IoT','Web Dev frontend','Mobile Apps','DevOps'],
      allowed:['Python','TensorFlow','PyTorch','Pandas','NumPy','Scikit-learn','Matplotlib','Statistics','Neural Networks','NLP','Jupyter'] },
    { id:'cloud-devops', name:'Cloud & DevOps', icon:'☁️', color:'#06b6d4',
      description:'Cloud infrastructure, containerization, CI/CD pipelines, and site reliability engineering',
      semanticContext:'AWS Amazon Web Services, Azure Microsoft cloud, GCP Google Cloud, Docker containers, Kubernetes orchestration, CI/CD pipelines, Jenkins automation, Terraform infrastructure as code, Ansible configuration, Helm charts, GitOps, Linux administration, Prometheus monitoring, Grafana dashboards, EKS, Lambda serverless',
      disallowed:['Frontend UI design','Game Dev','Blockchain','Mobile Dev','Data Science ML'],
      allowed:['AWS','Azure','GCP','Docker','Kubernetes','CI/CD','Terraform','Jenkins','Ansible','Linux','Prometheus','Grafana'] },
  ],
  messages: [],
  sessions: {},
  violations: {},
  globalRules: {
    abusive_language:    { id:'abusive_language',    icon:'🤬', label:'Abusive / vulgar / hateful language',           method:'AI semantic', enabled:true,  severity:'CRITICAL', description:'Blocks insults, hate speech, slurs, aggressive or unprofessional language.' },
    personal_info:       { id:'personal_info',       icon:'🔒', label:'Personal info — phone, email, IDs, passwords',  method:'AI semantic', enabled:true,  severity:'CRITICAL', description:'Blocks sharing of phone numbers, emails, addresses, OTPs, API keys, government IDs.' },
    political_religious: { id:'political_religious', icon:'⛔', label:'Political / religious discussions',              method:'AI semantic', enabled:true,  severity:'HIGH',     description:'Blocks political opinions, election content, religious debates, communal content.' },
    promotion_spam:      { id:'promotion_spam',      icon:'📢', label:'Promotions, advertising, self-promotion',       method:'AI semantic', enabled:true,  severity:'HIGH',     description:'Blocks course promotions, referral links, discount offers, brand marketing.' },
    financial_gambling:  { id:'financial_gambling',  icon:'💰', label:'Financial advice, crypto, gambling, trading',   method:'AI semantic', enabled:true,  severity:'HIGH',     description:'Blocks investment tips, crypto discussions, betting, stock trading content.' },
    illegal_unsafe:      { id:'illegal_unsafe',      icon:'🚨', label:'Illegal content, piracy, exam cheating',        method:'AI semantic', enabled:true,  severity:'CRITICAL', description:'Blocks pirated software, exam malpractice, hacking tutorials, unsafe practices.' },
    low_quality:         { id:'low_quality',         icon:'🗑️', label:'Spam, low-quality, no learning value',         method:'AI semantic', enabled:true,  severity:'MEDIUM',   description:'Blocks pure noise, excessive emojis, messages with zero educational value.' },
    repeat_spam:         { id:'repeat_spam',         icon:'🔁', label:'Repeated identical messages',                  method:'Server-side', enabled:true,  severity:'MEDIUM',   description:'Blocks a user from sending the same message twice in the same session.' },
    tone_check:          { id:'tone_check',          icon:'🎭', label:'Unprofessional or dismissive tone',             method:'AI semantic', enabled:true,  severity:'LOW',      description:'Flags messages that are overly dismissive, sarcastic, or condescending even without explicit abuse.' },
    sensitive_topics:    { id:'sensitive_topics',    icon:'🧨', label:'Mental health / self-harm references',         method:'AI semantic', enabled:true,  severity:'CRITICAL', description:'Blocks content related to self-harm, suicide, or content endangering wellbeing.' },
    competitor_mentions: { id:'competitor_mentions', icon:'🏴', label:'Negative competitor / platform mentions',       method:'AI semantic', enabled:true,  severity:'MEDIUM',   description:'Blocks disparaging remarks about WeLe platform, instructors, or competing platforms.' },
    language_check:      { id:'language_check',      icon:'🌐', label:'Non-English in English-only groups',           method:'AI semantic', enabled:false, severity:'LOW',      description:'Flags non-English messages in groups configured for English-only discussion. Off by default.' },
  },
  stats: {
    totalMessages: 0,
    blockedMessages: 0,
    allowedMessages: 0,
    violationsByCategory: {},
    violationsByGroup: {},
    violationsByUser: {},
    recentActivity: [],
    hourlyActivity: new Array(24).fill(0),
  },
};

// ── Middleware ────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token || !DB.sessions[token]) return res.status(401).json({ error: 'Unauthorized' });
  req.user = DB.sessions[token];
  next();
}
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ── API Key ───────────────────────────────────────────────────
app.post('/api/set-key', (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey || apiKey.trim().length < 10) return res.status(400).json({ error: 'Invalid key.' });
  API_KEY = apiKey.trim();
  res.json({ success: true });
});
app.get('/api/key-status', (req, res) => {
  res.json({ hasKey: !!API_KEY, provider: 'Groq', masked: API_KEY ? `gsk_...${API_KEY.slice(-6)}` : null });
});

// ── Auth ──────────────────────────────────────────────────────
app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required.' });
  if (!email?.includes('@')) return res.status(400).json({ error: 'Valid email required.' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password min 6 chars.' });
  if (DB.users.find(u => u.email.toLowerCase() === email.toLowerCase().trim()))
    return res.status(409).json({ error: 'Email already registered.' });
  const initials = name.trim().split(' ').map(w=>w[0].toUpperCase()).slice(0,2).join('');
  const colors = ['#6366f1','#8b5cf6','#06b6d4','#10b981','#f59e0b','#ef4444','#ec4899','#14b8a6'];
  const newUser = { id:'user_'+Date.now(), name:name.trim(), email:email.toLowerCase().trim(),
    password:hash(password), role:'learner', avatar:initials, color:colors[DB.users.length%colors.length],
    banned:false, skillset:'', groupId:'' };
  DB.users.push(newUser);
  const token = genToken();
  DB.sessions[token] = { ...newUser };
  res.status(201).json({ token, user:{ id:newUser.id, name:newUser.name, email:newUser.email, role:newUser.role, avatar:newUser.avatar, color:newUser.color, skillset:'', groupId:'' }});
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = DB.users.find(u => u.email === email && u.password === hash(password));
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });
  if (user.banned) return res.status(403).json({ error: 'Account suspended.' });
  const token = genToken();
  DB.sessions[token] = { ...user };
  res.json({ token, user:{ id:user.id, name:user.name, email:user.email, role:user.role, avatar:user.avatar, color:user.color, skillset:user.skillset, groupId:user.groupId }});
});

app.post('/api/auth/logout', authMiddleware, (req, res) => {
  delete DB.sessions[req.headers['authorization']?.replace('Bearer ','')];
  res.json({ success: true });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const u = DB.users.find(u => u.id === req.user.id);
  res.json({ id:u.id, name:u.name, email:u.email, role:u.role, avatar:u.avatar, color:u.color, skillset:u.skillset||'', groupId:u.groupId||'' });
});

app.post('/api/user/setup', authMiddleware, (req, res) => {
  const { skillset, groupId } = req.body;
  const user = DB.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  user.skillset = skillset || '';
  user.groupId = groupId || '';
  const tok = req.headers['authorization']?.replace('Bearer ','');
  if (DB.sessions[tok]) { DB.sessions[tok].skillset = user.skillset; DB.sessions[tok].groupId = user.groupId; }
  res.json({ success:true, skillset:user.skillset, groupId:user.groupId });
});

// ── Groups ────────────────────────────────────────────────────
app.get('/api/groups', authMiddleware, (req, res) => res.json(DB.groups));
app.put('/api/groups/:id', authMiddleware, adminOnly, (req, res) => {
  const i = DB.groups.findIndex(g => g.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Not found' });
  DB.groups[i] = { ...DB.groups[i], ...req.body };
  res.json(DB.groups[i]);
});

// ── Messages ──────────────────────────────────────────────────
app.get('/api/messages/:groupId', authMiddleware, (req, res) => {
  res.json(DB.messages.filter(m => m.groupId === req.params.groupId).slice(-50));
});
app.post('/api/messages', authMiddleware, (req, res) => {
  const msg = { id:Date.now().toString(), ...req.body, userId:req.user.id, userName:req.user.name,
    avatar:req.user.avatar, userColor:req.user.color, role:req.user.role, timestamp:Date.now() };
  DB.messages.push(msg);
  res.json(msg);
});

// ── Admin users ───────────────────────────────────────────────
app.get('/api/admin/users', authMiddleware, adminOnly, (req, res) => {
  res.json(DB.users.map(u => ({ id:u.id, name:u.name, email:u.email, role:u.role, avatar:u.avatar, color:u.color, banned:u.banned, skillset:u.skillset, groupId:u.groupId, violations:DB.violations[u.id]||0 })));
});
app.post('/api/admin/users/:id/ban', authMiddleware, adminOnly, (req, res) => {
  const u = DB.users.find(u => u.id === req.params.id);
  if (!u) return res.status(404).json({ error:'Not found' });
  u.banned = true; res.json({ success:true });
});
app.post('/api/admin/users/:id/unban', authMiddleware, adminOnly, (req, res) => {
  const u = DB.users.find(u => u.id === req.params.id);
  if (!u) return res.status(404).json({ error:'Not found' });
  u.banned = false; DB.violations[u.id] = 0; res.json({ success:true });
});

// ── Violations ────────────────────────────────────────────────
app.post('/api/violations/:userId', authMiddleware, (req, res) => {
  DB.violations[req.params.userId] = (DB.violations[req.params.userId] || 0) + 1;
  const count = DB.violations[req.params.userId];
  if (count >= 3) { const u = DB.users.find(u => u.id === req.params.userId); if (u) u.banned = true; }
  res.json({ count, banned: count >= 3 });
});
app.get('/api/violations/:userId', authMiddleware, (req, res) => {
  res.json({ count: DB.violations[req.params.userId] || 0 });
});

// ── Global Rules ──────────────────────────────────────────────
app.get('/api/global-rules', authMiddleware, (req, res) => {
  res.json(Object.values(DB.globalRules));
});
app.put('/api/global-rules/:id', authMiddleware, adminOnly, (req, res) => {
  const rule = DB.globalRules[req.params.id];
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  DB.globalRules[req.params.id] = { ...rule, ...req.body };
  console.log(`🔧 Rule "${req.params.id}" → enabled=${DB.globalRules[req.params.id].enabled}`);
  res.json(DB.globalRules[req.params.id]);
});

// ── Stats ─────────────────────────────────────────────────────
app.get('/api/stats', authMiddleware, adminOnly, (req, res) => {
  const s = DB.stats;
  const topViolators = Object.entries(s.violationsByUser || {})
    .sort((a,b) => b[1]-a[1]).slice(0,5)
    .map(([userId, count]) => {
      const u = DB.users.find(x => x.id === userId);
      return { userId, name:u?.name||userId, count, banned:u?.banned||false };
    });
  res.json({ ...s, topViolators,
    totalUsers: DB.users.filter(u=>u.role!=='admin').length,
    bannedUsers: DB.users.filter(u=>u.banned).length,
    activeGroups: DB.groups.length,
    enabledRules: Object.values(DB.globalRules).filter(r=>r.enabled).length,
    disabledRules: Object.values(DB.globalRules).filter(r=>!r.enabled).length,
  });
});

app.post('/api/stats/event', authMiddleware, (req, res) => {
  const { allowed, violation_category, groupId, userId, toxicity_level, userName } = req.body;
  const s = DB.stats;
  s.totalMessages++;
  if (allowed) { s.allowedMessages++; }
  else {
    s.blockedMessages++;
    if (violation_category && violation_category !== 'none') {
      s.violationsByCategory[violation_category] = (s.violationsByCategory[violation_category]||0)+1;
    }
    if (groupId) s.violationsByGroup[groupId] = (s.violationsByGroup[groupId]||0)+1;
    if (userId)  s.violationsByUser[userId]   = (s.violationsByUser[userId]||0)+1;
  }
  const hour = new Date().getHours();
  s.hourlyActivity[hour] = (s.hourlyActivity[hour]||0)+1;
  s.recentActivity.unshift({ allowed, violation_category, groupId, userId, userName:userName||'Unknown', toxicity_level, timestamp:Date.now() });
  if (s.recentActivity.length > 100) s.recentActivity.pop();
  res.json({ success:true });
});

// ── Agentic Context Resolver ──────────────────────────────────
app.post('/api/agent/resolve-context', authMiddleware, async (req, res) => {
  if (!API_KEY) return res.status(401).json({ error: 'No API key.' });
  const { skillset, groupId, message } = req.body;
  const group = DB.groups.find(g => g.id === groupId);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  const prompt = `You are an intelligent context resolver for a learning community platform.
USER SKILLSET: "${skillset||'Not specified'}"
GROUP: "${group.name}"
GROUP DESCRIPTION: "${group.description}"
GROUP SEMANTIC CONTEXT: "${group.semanticContext}"
MESSAGE: "${message}"
Determine if this message is semantically relevant to the group, considering the user's skillset and group purpose. Think beyond keywords.
RULES:
1. Python ML in Data Science group = RELEVANT
2. Java group general CS = RELEVANT
3. Docker in Java group = BORDERLINE
4. Entertainment/personal = NEVER relevant
5. Consider user skill level from skillset
Respond ONLY valid JSON:
{"is_relevant":true,"relevance_score":0-100,"reasoning":"brief","semantic_match":["concepts"],"suggested_group":"id or null"}`;
  try { res.json(JSON.parse(await groqCall(prompt, 400))); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Main Moderation ───────────────────────────────────────────
app.post('/api/moderate', authMiddleware, async (req, res) => {
  if (!API_KEY) return res.status(401).json({ error: 'No API key.' });
  const userMessage = req.body.messages?.find(m => m.role === 'user')?.content || '';
  if (!userMessage) return res.status(400).json({ error: 'No message.' });
  try {
    const raw = await groqCall(userMessage, 900);
    res.json({ content:[{ type:'text', text:raw }] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Groq API helper ───────────────────────────────────────────
async function groqCall(prompt, maxTokens=800) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role:'system', content:'You are a strict JSON-only AI. Respond ONLY with valid JSON. No markdown, no explanation.' },
        { role:'user', content:prompt },
      ],
      temperature: 0.1, max_tokens: maxTokens,
      response_format: { type:'json_object' },
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `HTTP ${response.status}`);
  const text = data.choices?.[0]?.message?.content || '';
  if (!text) throw new Error('Empty response from Groq');
  return text;
}

app.listen(PORT, () => {
  console.log('\n🛡️  WeLe Guard v3  →  http://localhost:' + PORT);
  console.log('🤖  Provider: Groq llama-3.3-70b-versatile (FREE)');
  if (!API_KEY) console.log('⚠️  No key — enter in browser UI\n');
});
