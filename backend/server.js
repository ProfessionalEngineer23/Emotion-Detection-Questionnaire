// --- add near the top ---
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid'); // npm i uuid (add to package.json)

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE  = path.join(DATA_DIR, 'surveys.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

let DB = { surveys:{}, responses:{} };
try { DB = JSON.parse(fs.readFileSync(DB_FILE,'utf8')); } catch {}
function save(){ fs.writeFileSync(DB_FILE, JSON.stringify(DB,null,2)); }

// --- ensure body parser is enabled ---
app.use(require('express').json());

// --- API: create survey ---
app.post('/api/surveys', (req,res)=>{
  const { title, questions } = req.body || {};
  if(!Array.isArray(questions)) return res.status(400).json({error:'questions required'});
  const id = uuidv4().slice(0,8);
  DB.surveys[id] = { id, title: title || 'Untitled', questions };
  DB.responses[id] = [];
  save();
  res.json({ id });
});

// --- API: get survey ---
app.get('/api/surveys/:id', (req,res)=>{
  const s = DB.surveys[req.params.id];
  if(!s) return res.sendStatus(404);
  res.json(s);
});

// --- API: submit responses ---
app.post('/api/surveys/:id/responses', (req,res)=>{
  const id = req.params.id;
  if(!DB.surveys[id]) return res.sendStatus(404);
  const { answers } = req.body || {};
  if(!Array.isArray(answers)) return res.status(400).json({error:'answers required'});
  DB.responses[id].push({ ts: Date.now(), answers });
  save();
  res.json({ ok:true });
});

// --- API: basic analytics ---
app.get('/api/surveys/:id/analytics', (req,res)=>{
  const id = req.params.id;
  const s = DB.surveys[id]; if(!s) return res.sendStatus(404);
  const R = DB.responses[id] || [];
  const out = s.questions.map((q,qi)=>{
    if(q.type==='mcq'){
      const labels = (q.options||[]).map(o=>o||'Option');
      const counts = labels.map(()=>0);
      R.forEach(r=>{
        const a = r.answers[qi]?.answer;
        const idx = labels.indexOf(a);
        if(idx>=0) counts[idx]++;
      });
      return { type:'mcq', text:q.text, labels, counts };
    }
    if(q.type==='scale'){
      const min = Number(q.min||1), max = Number(q.max||5);
      const bins = Array.from({length:(max-min+1)}, (_,i)=>({label:String(min+i),count:0}));
      R.forEach(r=>{
        const v = Number(r.answers[qi]?.answer);
        const bi = Math.round(v)-min;
        if(bi>=0 && bi<bins.length) bins[bi].count++;
      });
      return { type:'scale', text:q.text, bins };
    }
    // text
    const count = R.reduce((n,r)=> r.answers[qi]?.answer ? n+1 : n, 0);
    return { type:'text', text:q.text, count };
  });
  res.json(out);
});
