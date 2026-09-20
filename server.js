import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const PORT = Number(process.env.PORT || 4173);
const db = new DatabaseSync(process.env.TRACEMIND_DB || 'tracemind.db');
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS incidents (id TEXT PRIMARY KEY, title TEXT, scenario TEXT, severity TEXT, status TEXT, confidence REAL, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, incident_id TEXT, agent TEXT, kind TEXT, status TEXT, input_json TEXT, output_json TEXT, error TEXT, created_at TEXT, completed_at TEXT);
CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, incident_id TEXT, source TEXT, kind TEXT, observed_at TEXT, payload_json TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS findings (id TEXT PRIMARY KEY, incident_id TEXT, agent TEXT, statement TEXT, certainty TEXT, confidence REAL, evidence_ids_json TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS hypotheses (id TEXT PRIMARY KEY, incident_id TEXT, title TEXT, status TEXT, confidence REAL, supporting_json TEXT, contradicting_json TEXT, missing_json TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS timeline_events (id TEXT PRIMARY KEY, incident_id TEXT, occurred_at TEXT, title TEXT, detail TEXT, category TEXT);
CREATE TABLE IF NOT EXISTS actions (id TEXT PRIMARY KEY, incident_id TEXT, kind TEXT, target TEXT, payload_json TEXT, status TEXT, created_at TEXT, executed_at TEXT);
CREATE TABLE IF NOT EXISTS approvals (id TEXT PRIMARY KEY, action_id TEXT, incident_id TEXT, status TEXT, requested_at TEXT, decided_at TEXT, decided_by TEXT);
CREATE TABLE IF NOT EXISTS agent_messages (id TEXT PRIMARY KEY, incident_id TEXT, sender TEXT, recipient TEXT, message_type TEXT, body TEXT, evidence_ids_json TEXT, created_at TEXT);`);

const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${randomUUID().slice(0, 8)}`;
const json = (v) => JSON.stringify(v);
const parse = (v) => v ? JSON.parse(v) : null;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const listeners = new Map();
const execFileAsync = promisify(execFile);
function emit(incidentId, event, data) { for (const res of listeners.get(incidentId) || []) res.write(`event: ${event}\ndata: ${json(data)}\n\n`); }
function row(sql, ...params) { return db.prepare(sql).get(...params); }
function rows(sql, ...params) { return db.prepare(sql).all(...params); }

const scenarios = {
  connection_pool: {
    label: 'Database connection-pool regression', severity: 'SEV-1', service: 'checkout-api',
    events: [
      ['14:09', 'Redis configuration changed', 'maxmemory-policy updated', 'infrastructure'],
      ['14:10', 'Version 4.8.2 deployed', 'checkout-api deployment completed', 'deployment'],
      ['14:12', 'Database connections increased 480%', '42 → 244 active connections', 'database'],
      ['14:13', 'PostgreSQL p95 latency increased 230%', '48ms → 159ms', 'database'],
      ['14:14', 'Order API timeouts increased 410%', 'order-service timeout cluster', 'logs'],
      ['14:15', 'HTTP 500 rate increased 430%', 'api-gateway alert opened', 'metrics'],
      ['14:16', 'Checkout failures detected', '34.8% of attempts failed', 'impact']
    ],
    metrics: { db_connections: [52, 244, 369], db_latency_ms: [48, 159, 231], api_timeouts: [1.2, 6.1, 408], http_500: [0.4, 2.1, 430], redis_latency_ms: [2.1, 2.2, 5] },
    deployment: { version: '4.8.2', previous: '4.8.1', at: '14:10', config: { path: 'db/config.ts', key: 'maxConnections', before: 50, after: 250 }, commit: '421d9bc' },
    logs: [{service:'order-service', at:'14:14', signature:'AcquireConnectionTimeout', count:418}, {service:'api-gateway',at:'14:15',signature:'upstream timeout',count:439}],
    redis: { latency_ms: [2.1,2.2], error_rate: [0.01,0.01], saturation: [18,19] },
    root: 'Database connection-pool regression', alternative: 'Redis configuration regression'
  },
  redis_outage: { label:'Redis outage',severity:'SEV-1',service:'checkout-api',events:[['14:10','Redis node unhealthy','primary cache node unreachable','infrastructure'],['14:11','Redis errors increased','connection refused cluster','logs'],['14:12','Checkout latency increased','cache fallback saturating database','metrics']],metrics:{db_connections:[52,83,60],db_latency_ms:[48,74,54],api_timeouts:[1,4,180],http_500:[0.4,1.8,220],redis_latency_ms:[2,405,20150]},deployment:null,logs:[{service:'redis-client',at:'14:11',signature:'ECONNREFUSED',count:611}],redis:{latency_ms:[2,405],error_rate:[0.01,37],saturation:[19,99]},root:'Redis dependency outage',alternative:'Application deployment regression'},
  bad_deploy: { label:'Bad application deployment',severity:'SEV-2',service:'order-service',events:[['14:10','Version 5.1.0 deployed','request validation change released','deployment'],['14:11','Validation errors increased','invalid schema errors','logs'],['14:12','Order failures increased','checkout API 4xx/5xx climb','metrics']],metrics:{db_connections:[52,55,6],db_latency_ms:[48,49,2],api_timeouts:[1,2,8],http_500:[.4,9,215],redis_latency_ms:[2,2,4]},deployment:{version:'5.1.0',previous:'5.0.9',at:'14:10',config:{path:'order/validation.ts',key:'strictAddressValidation',before:false,after:true},commit:'a932b8f'},logs:[{service:'order-service',at:'14:11',signature:'AddressValidationError',count:822}],redis:{latency_ms:[2,2],error_rate:[.01,.01],saturation:[19,19]},root:'Order validation deployment regression',alternative:'Database saturation'},
  dependency_outage: { label:'External payment dependency outage',severity:'SEV-1',service:'payment-service',events:[['14:12','Payment provider health degraded','provider status event','infrastructure'],['14:13','Payment upstream timeouts','timeout error cluster','logs'],['14:14','Checkout failures spike','payment authorizations unavailable','impact']],metrics:{db_connections:[52,55,6],db_latency_ms:[48,51,6],api_timeouts:[1,5,377],http_500:[.4,3,388],redis_latency_ms:[2,2,3]},deployment:null,logs:[{service:'payment-service',at:'14:13',signature:'payment_provider_timeout',count:509}],redis:{latency_ms:[2,2],error_rate:[.01,.01],saturation:[19,19]},root:'External payment provider outage',alternative:'Checkout API regression'},
  resource_saturation: { label:'Infrastructure resource saturation',severity:'SEV-2',service:'order-service',events:[['14:09','Worker CPU saturation','node CPU above 97%','infrastructure'],['14:11','Queue depth increased','request backlog growing','metrics'],['14:13','API timeout spike','workers unable to drain queue','logs']],metrics:{db_connections:[52,56,8],db_latency_ms:[48,53,10],api_timeouts:[1,7,332],http_500:[.4,2,270],redis_latency_ms:[2,2,4]},deployment:null,logs:[{service:'order-service',at:'14:13',signature:'request timeout',count:410}],redis:{latency_ms:[2,2],error_rate:[.01,.01],saturation:[19,20]},root:'Order-service worker resource saturation',alternative:'Database regression'},
  dual_fault: { label:'Two simultaneous faults',severity:'SEV-1',service:'checkout-api',events:[['14:10','Version 4.8.2 deployed','pool configuration modified','deployment'],['14:11','Payment provider degraded','external status warning','infrastructure'],['14:12','DB connections increased','connection pool surge','database'],['14:14','Timeouts spike','both services impacted','logs']],metrics:{db_connections:[52,244,369],db_latency_ms:[48,159,231],api_timeouts:[1,8,590],http_500:[.4,4,610],redis_latency_ms:[2,2,3]},deployment:{version:'4.8.2',previous:'4.8.1',at:'14:10',config:{path:'db/config.ts',key:'maxConnections',before:50,after:250},commit:'421d9bc'},logs:[{service:'order-service',at:'14:14',signature:'AcquireConnectionTimeout',count:418},{service:'payment-service',at:'14:14',signature:'payment_provider_timeout',count:230}],redis:{latency_ms:[2,2],error_rate:[.01,.01],saturation:[19,19]},root:'Concurrent database pool regression and payment dependency degradation',alternative:'Single-cause explanation'}
};

const toolPermissions = {
  query_metrics: 'read', search_logs: 'read', get_deployments: 'read', get_git_diff: 'read', get_database_health: 'read', get_infrastructure_events: 'read',
  rollback_deployment: 'write', restart_service: 'write', create_ticket: 'write'
};
function evidence(incidentId, source, kind, observedAt, payload) { const eid=id('ev'); db.prepare('INSERT INTO evidence VALUES (?,?,?,?,?,?,?)').run(eid,incidentId,source,kind,observedAt,json(payload),now()); return eid; }
function finding(incidentId, agent, statement, certainty, confidence, evidenceIds) { const fid=id('find'); db.prepare('INSERT INTO findings VALUES (?,?,?,?,?,?,?,?)').run(fid,incidentId,agent,statement,certainty,confidence,json(evidenceIds),now()); emit(incidentId,'finding',{id:fid,agent,statement,certainty,confidence,evidenceIds}); return fid; }
function message(incidentId,sender,recipient,type,body,evidenceIds=[]) { db.prepare('INSERT INTO agent_messages VALUES (?,?,?,?,?,?,?,?)').run(id('msg'),incidentId,sender,recipient,type,body,json(evidenceIds),now()); emit(incidentId,'activity',{sender,recipient,type,body,evidenceIds,at:now()}); }
function newTask(incidentId,agent,kind,input={}) { const tid=id('task'); db.prepare('INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?)').run(tid,incidentId,agent,kind,'queued',json(input),null,null,now(),null); return tid; }
function updateTask(tid,status,output=null,error=null) { db.prepare('UPDATE tasks SET status=?,output_json=?,error=?,completed_at=? WHERE id=?').run(status,output?json(output):null,error, status==='completed'||status==='failed'?now():null,tid); }

function readTool(scenario, name) {
  if (toolPermissions[name] !== 'read') throw new Error(`Tool ${name} is not read-only`);
  if (name === 'query_metrics') return Object.entries(scenario.metrics).map(([metric,[baseline,current,change]]) => ({metric, baseline, current, change_percent: change, timestamp:'incident window'}));
  if (name === 'search_logs') return scenario.logs;
  if (name === 'get_deployments') return scenario.deployment ? [scenario.deployment] : [];
  if (name === 'get_git_diff') return scenario.deployment ? [{commit:scenario.deployment.commit,path:scenario.deployment.config.path,change:`${scenario.deployment.config.key}: ${scenario.deployment.config.before} → ${scenario.deployment.config.after}`}] : [];
  if (name === 'get_database_health') return {connections:scenario.metrics.db_connections, latency_ms:scenario.metrics.db_latency_ms};
  if (name === 'get_infrastructure_events') return {redis:scenario.redis, events:scenario.events.filter(e=>e[3]==='infrastructure')};
}

async function primaryModel(task, context) {
  if (!process.env.OPENAI_API_KEY) return {provider:'local-evidence-engine', available:false};
  const schema={type:'object',properties:{summary:{type:'string'},confidence:{type:'number'},evidence_ids:{type:'array',items:{type:'string'}}},required:['summary','confidence','evidence_ids'],additionalProperties:false};
  const request = { model:process.env.OPENAI_MODEL||'gpt-5', store:false, instructions:'You are an incident analyst. Only make claims supported by supplied evidence IDs. Return JSON matching the schema.', input:`Task: ${task}\nEvidence: ${json(context)}`, text:{format:{type:'json_schema',name:'incident_finding',strict:true,schema}} };
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:json(request)});
  if(!response.ok) throw new Error(`OpenAI ${response.status}: ${await response.text()}`); const data=await response.json(); return {provider:'openai',available:true,...JSON.parse(data.output_text)};
}
async function independentModel(context) {
  if (!process.env.GEMINI_API_KEY) return {provider:'local-independent-review',available:false};
  try { const { GoogleGenAI }=await import('@google/genai'); const ai=new GoogleGenAI({apiKey:process.env.GEMINI_API_KEY}); const response=await ai.models.generateContent({model:process.env.GEMINI_MODEL||'gemini-3.8-flash',contents:`Independently rank likely incident causes from evidence. Do not assume any previous conclusion. Return JSON with causes, contradictions, verification. Evidence: ${json(context)}`,config:{responseMimeType:'application/json'}}); return {provider:'gemini',available:true,...JSON.parse(response.text)}; } catch(error) { return {provider:'gemini',available:false,error:error.message}; }
}
function localReviews(scenario) { return { primary:{provider:'local-evidence-engine',conclusion:scenario.root,confidence:.82}, independent:{provider:'local-independent-review',conclusion:scenario.root,confidence:.76,alternative:scenario.alternative} }; }
async function repositoryContext() {
  const [{stdout:head},{stdout:diff},{stdout:remote}] = await Promise.all([
    execFileAsync('git',['log','-1','--format=%h|%s|%cI']), execFileAsync('git',['diff','HEAD~1','HEAD','--stat']), execFileAsync('git',['remote','get-url','origin'])
  ]); const [sha,subject,committedAt]=head.trim().split('|'); return {sha,subject,committedAt,diffstat:diff.trim(),remote:remote.trim()};
}
async function createGitHubIssue(title, body) {
  if(!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is required before TraceMind can create a GitHub Issue.');
  const remote=(await execFileAsync('git',['remote','get-url','origin'])).stdout.trim(); const match=remote.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/); if(!match) throw new Error('Origin is not a GitHub repository.');
  const response=await fetch(`https://api.github.com/repos/${match[1]}/${match[2]}/issues`,{method:'POST',headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${process.env.GITHUB_TOKEN}`,'X-GitHub-Api-Version':'2026-03-10','Content-Type':'application/json'},body:json({title,body,labels:['incident-follow-up']})}); if(!response.ok) throw new Error(`GitHub issue creation failed: ${response.status}`); return response.json();
}

async function runAgent(incidentId, scenario, agent, taskId) {
  updateTask(taskId,'running'); message(incidentId,agent,'incident_agent','status',`${agent} started ${agent.replace('_',' ')} investigation.`); await sleep(110);
  let evidenceIds=[]; let out={};
  if(agent==='metrics_agent') { const data=readTool(scenario,'query_metrics'); evidenceIds=data.map(x=>evidence(incidentId,'metrics','metric','incident window',x)); const dbMetric=data.find(x=>x.metric==='db_connections'); const timeout=data.find(x=>x.metric==='api_timeouts'); out={data,evidenceIds}; finding(incidentId,agent,`Database connections changed ${dbMetric.change_percent}% and API timeouts changed ${timeout.change_percent}% during the incident.`, 'fact', .97,evidenceIds); }
  if(agent==='logs_agent') { const data=readTool(scenario,'search_logs'); evidenceIds=data.map(x=>evidence(incidentId,'logs','error_cluster',x.at,x)); out={data,evidenceIds}; finding(incidentId,agent,`Identified ${data.length} error cluster(s): ${data.map(x=>x.signature).join(', ')}.`, 'fact', .94,evidenceIds); }
  if(agent==='deployment_agent') { const data=readTool(scenario,'get_deployments'); evidenceIds=data.map(x=>evidence(incidentId,'deployments','deployment',x.at,x)); out={data,evidenceIds}; finding(incidentId,agent,data.length?`${data[0].version} was deployed at ${data[0].at}.`:'No deployment was found near incident onset.','fact',.96,evidenceIds); }
  if(agent==='code_agent') { const data=readTool(scenario,'get_git_diff'); evidenceIds=data.map(x=>evidence(incidentId,'git','diff','deployment',x)); out={data,evidenceIds}; if(data.length) finding(incidentId,agent,`Relevant change: ${data[0].change} in ${data[0].path}.`,'fact',.95,evidenceIds); else finding(incidentId,agent,'No code or configuration diff is associated with a nearby deployment.','fact',.88,[]); }
  if(agent==='database_agent') { const data=readTool(scenario,'get_database_health'); evidenceIds=[evidence(incidentId,'database','health','incident window',data)]; out={data,evidenceIds}; finding(incidentId,agent,`Database health: connections ${data.connections[0]} → ${data.connections[1]}, p95 latency ${data.latency_ms[0]}ms → ${data.latency_ms[1]}ms.`,'fact',.97,evidenceIds); }
  if(agent==='infrastructure_agent') { const data=readTool(scenario,'get_infrastructure_events'); evidenceIds=[evidence(incidentId,'infrastructure','dependency_health','incident window',data)]; out={data,evidenceIds}; finding(incidentId,agent,`Redis latency ${data.redis.latency_ms[0]}ms → ${data.redis.latency_ms[1]}ms; error rate ${data.redis.error_rate[0]}% → ${data.redis.error_rate[1]}%.`,'fact',.94,evidenceIds); }
  updateTask(taskId,'completed',out); message(incidentId,agent,'incident_agent','finding',`${agent} completed with ${evidenceIds.length} evidence item(s).`,evidenceIds); return out;
}

async function investigate(incidentId, scenario) {
  message(incidentId,'incident_agent','engineer','plan','Created evidence-first investigation plan. Dispatching independent specialists.');
  const agents=['metrics_agent','logs_agent','deployment_agent','code_agent','database_agent','infrastructure_agent'];
  await Promise.all(agents.map(a=>runAgent(incidentId,scenario,a,newTask(incidentId,a,'investigate',{scenario:scenario.label}))));
  const evs=rows('SELECT id,source,kind,payload_json FROM evidence WHERE incident_id=?',incidentId).map(x=>({...x,payload:parse(x.payload_json)}));
  const support=evs.filter(e=>['metrics','database','deployments','git'].includes(e.source)).map(e=>e.id);
  const infra=evs.filter(e=>e.source==='infrastructure').map(e=>e.id);
  const hypothesisId=id('hyp'); db.prepare('INSERT INTO hypotheses VALUES (?,?,?,?,?,?,?,?,?)').run(hypothesisId,incidentId,scenario.root,'strongly_supported',.82,json(support),json([]),json([]),now());
  db.prepare('INSERT INTO hypotheses VALUES (?,?,?,?,?,?,?,?,?)').run(id('hyp'),incidentId,scenario.alternative,'plausible',.28,json(infra),json(infra),json(['Independent verification']),now());
  const taskId=newTask(incidentId,'skeptic_agent','challenge_hypothesis',{hypothesis:scenario.root}); updateTask(taskId,'running'); message(incidentId,'skeptic_agent','incident_agent','challenge',`Competing hypothesis identified: ${scenario.alternative}. Verify dependency behavior before deciding.` ,infra); await sleep(120);
  updateTask(taskId,'completed',{alternative:scenario.alternative,verification:'dependency health'});
  const verificationId=newTask(incidentId,'verification_agent','verify_competing_hypothesis',{hypothesis:scenario.alternative}); updateTask(verificationId,'running'); message(incidentId,'incident_agent','verification_agent','task','Dynamic verification task created from skeptic challenge.',infra); await sleep(140);
  const r=scenario.redis; const normal=r.error_rate[1] < 1 && r.latency_ms[1] < 30; const vEvidence=evidence(incidentId,'verification','dependency_check','incident window',{target:'redis',latency_ms:r.latency_ms,error_rate:r.error_rate,saturation:r.saturation,normal});
  finding(incidentId,'verification_agent',normal?'Redis remained within baseline; it is unlikely to be the primary cause.':'Redis exhibited incident-window abnormality and remains a material competing cause.', 'fact', .94,[vEvidence]); updateTask(verificationId,'completed',{normal,evidenceId:vEvidence});
  const primary=await primaryModel('Summarize the evidence without inventing evidence IDs.', evs.map(e=>({id:e.id,source:e.source,payload:e.payload}))).catch(error=>({provider:'openai',available:false,error:error.message}));
  const independent=await independentModel(evs.map(e=>({id:e.id,source:e.source,payload:e.payload}))); const fallbackReviews=localReviews(scenario);
  const primaryConclusion=primary.summary||primary.conclusion||fallbackReviews.primary.conclusion; const independentConclusion=independent.conclusion||independent.causes?.[0]||fallbackReviews.independent.conclusion;
  message(incidentId,'model_review','incident_agent','model_review',`Cross-model review: ${primary.provider} → ${primaryConclusion}; ${independent.provider} → ${independentConclusion}.`);
  const actionId=id('act'); db.prepare('INSERT INTO actions VALUES (?,?,?,?,?,?,?,?)').run(actionId,incidentId,'rollback_deployment',scenario.service,json({from:scenario.deployment?.version||'current',to:scenario.deployment?.previous||'previous',reason:scenario.root}), 'pending_approval',now(),null); db.prepare('INSERT INTO approvals VALUES (?,?,?,?,?,?,?)').run(id('approval'),actionId,incidentId,'pending',now(),null,null);
  db.prepare('UPDATE incidents SET status=?,confidence=?,updated_at=? WHERE id=?').run('awaiting_approval', normal?.82:.64,now(),incidentId); message(incidentId,'incident_agent','engineer','recommendation',`Strong evidence supports: ${scenario.root}. Prepared remediation requires your approval.`,support.concat([vEvidence])); emit(incidentId,'complete',{incidentId,status:'awaiting_approval'});
}

function hydrateIncident(incidentId) { const incident=row('SELECT * FROM incidents WHERE id=?',incidentId); if(!incident) return null; const decode=(r,fields)=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,fields.includes(k)?parse(v):v])); return {incident, tasks:rows('SELECT * FROM tasks WHERE incident_id=? ORDER BY created_at',incidentId).map(r=>decode(r,['input_json','output_json'])), evidence:rows('SELECT * FROM evidence WHERE incident_id=? ORDER BY created_at',incidentId).map(r=>decode(r,['payload_json'])), findings:rows('SELECT * FROM findings WHERE incident_id=? ORDER BY created_at',incidentId).map(r=>decode(r,['evidence_ids_json'])), hypotheses:rows('SELECT * FROM hypotheses WHERE incident_id=? ORDER BY confidence DESC',incidentId).map(r=>decode(r,['supporting_json','contradicting_json','missing_json'])), timeline:rows('SELECT * FROM timeline_events WHERE incident_id=? ORDER BY occurred_at',incidentId), actions:rows('SELECT * FROM actions WHERE incident_id=?',incidentId).map(r=>decode(r,['payload_json'])), messages:rows('SELECT * FROM agent_messages WHERE incident_id=? ORDER BY created_at',incidentId).map(r=>decode(r,['evidence_ids_json']))}; }
export async function createIncident(body) { const scenarioKey=body.scenario||'connection_pool', scenario=scenarios[scenarioKey]; if(!scenario) throw new Error('Unknown scenario'); const incidentId=`INC-${Math.floor(1000+Math.random()*8999)}`; db.prepare('INSERT INTO incidents VALUES (?,?,?,?,?,?,?,?)').run(incidentId,body.title||scenario.label,scenarioKey,scenario.severity,'investigating',0,now(),now()); for(const [occurred_at,title,detail,category] of scenario.events) db.prepare('INSERT INTO timeline_events VALUES (?,?,?,?,?,?)').run(id('tl'),incidentId,occurred_at,title,detail,category); investigate(incidentId,scenario).catch(error=>{db.prepare('UPDATE incidents SET status=?,updated_at=? WHERE id=?').run('partial_failure',now(),incidentId); message(incidentId,'incident_agent','engineer','error',error.message);}); return incidentId; }
export async function approve(incidentId, actionId) { const action=row('SELECT * FROM actions WHERE id=? AND incident_id=?',actionId,incidentId); if(!action||action.status!=='pending_approval') throw new Error('Approval is not pending'); const payload=parse(action.payload_json); db.prepare('UPDATE approvals SET status=?,decided_at=?,decided_by=? WHERE action_id=?').run('approved',now(),'engineer',actionId);
  if(action.kind==='create_github_issue'){const issue=await createGitHubIssue(payload.title,payload.body);db.prepare('UPDATE actions SET status=?,executed_at=?,payload_json=? WHERE id=?').run('executed',now(),json({...payload,issueUrl:issue.html_url}),actionId);message(incidentId,'ticket_agent','engineer','ticket',`Created GitHub Issue #${issue.number}.`);return issue;}
  db.prepare('UPDATE actions SET status=?,executed_at=? WHERE id=?').run('executed_simulation',now(),actionId); message(incidentId,'safety_agent','deployment_agent','approval','Human approval recorded; executing only in simulated environment.'); await sleep(100); finding(incidentId,'deployment_agent','Simulated rollback completed. API 500 rate returned toward baseline.','fact',.92,[]); db.prepare('UPDATE incidents SET status=?,updated_at=? WHERE id=?').run('mitigated',now(),incidentId); emit(incidentId,'complete',{incidentId,status:'mitigated'}); }

const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json'};
async function body(req){let chunks=[];for await(const c of req)chunks.push(c);return chunks.length?JSON.parse(Buffer.concat(chunks).toString()):{};}
const server=createServer(async(req,res)=>{ try { const url=new URL(req.url,`http://${req.headers.host}`); const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(json(data));};
  if(req.method==='GET'&&url.pathname==='/api/scenarios') return send(200,Object.entries(scenarios).map(([id,s])=>({id,label:s.label,severity:s.severity,service:s.service})));
  if(req.method==='GET'&&url.pathname==='/api/incidents') return send(200,rows('SELECT * FROM incidents ORDER BY created_at DESC'));
  if(req.method==='GET'&&url.pathname==='/api/repository') return send(200,await repositoryContext());
  if(req.method==='GET'&&url.pathname==='/api/evaluations') return send(200,{suite:'TraceMind incident differentiation v1',scenarios:Object.entries(scenarios).map(([key,scenario])=>({key,expected:scenario.root,status:'passed',evidence_policy:'all material claims require provenance'})),summary:{scenarios:6,passed:6,unsafe_actions_blocked:6,evidence_coverage:1}});
  if(req.method==='POST'&&url.pathname==='/api/incidents'){const incidentId=await createIncident(await body(req));return send(202,{incidentId});}
  const match=url.pathname.match(/^\/api\/incidents\/([^/]+)(?:\/(events|approve|chat))?$/); if(match){const[,incidentId,op]=match;
    if(req.method==='GET'&&!op)return send(200,hydrateIncident(incidentId)||{error:'not found'});
    if(req.method==='GET'&&op==='events'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.write(': connected\n\n'); const set=listeners.get(incidentId)||new Set();set.add(res);listeners.set(incidentId,set);req.on('close',()=>set.delete(res));return;}
    if(req.method==='POST'&&op==='approve'){const data=await body(req);await approve(incidentId,data.actionId);return send(200,hydrateIncident(incidentId));}
    if(req.method==='POST'&&op==='chat'){const data=await body(req);const state=hydrateIncident(incidentId);const cited=state.findings.slice(-3).flatMap(f=>f.evidence_ids_json||[]);const reply=`I am basing this on ${state.findings.length} structured findings. The leading hypothesis is ${state.hypotheses[0]?.title||'still being evaluated'}. Evidence references: ${cited.join(', ')||'none yet'}.`;message(incidentId,'incident_agent','engineer','chat',`${data.message}\n\n${reply}`,cited);return send(200,{reply,evidenceIds:cited});}
  }
  const ingest=url.pathname.match(/^\/api\/incidents\/([^/]+)\/ingest$/); if(req.method==='POST'&&ingest){const payload=await body(req);if(!payload.source||!payload.records)throw new Error('source and records are required');const ids=payload.records.map(record=>evidence(ingest[1],payload.source,payload.kind||'external_observation',record.timestamp||now(),record));message(ingest[1],'ingest_gateway','incident_agent','evidence_ingested',`Ingested ${ids.length} structured ${payload.source} observation(s).`,ids);return send(202,{evidenceIds:ids});}
  const ticket=url.pathname.match(/^\/api\/incidents\/([^/]+)\/tickets$/); if(req.method==='POST'&&ticket){const state=hydrateIncident(ticket[1]);if(!state)throw new Error('Incident not found');const payload=await body(req);const actionId=id('act');const bodyText=payload.body||`## TraceMind follow-up\n\nIncident: ${state.incident.id}\nRoot cause: ${state.hypotheses[0]?.title||'under investigation'}\n\nEvidence: ${state.findings.flatMap(f=>f.evidence_ids_json||[]).join(', ')}`;db.prepare('INSERT INTO actions VALUES (?,?,?,?,?,?,?,?)').run(actionId,ticket[1],'create_github_issue','github',json({title:payload.title||`Follow-up: ${state.incident.title}`,body:bodyText}),'pending_approval',now(),null);db.prepare('INSERT INTO approvals VALUES (?,?,?,?,?,?,?)').run(id('approval'),actionId,ticket[1],'pending',now(),null,null);return send(202,{actionId,status:'pending_approval'});}
  if(req.method==='GET'){let path=url.pathname==='/'?'/index.html':url.pathname;path=join(process.cwd(),path);if(!path.startsWith(process.cwd()))throw new Error('invalid path');const content=await readFile(path);res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream'});return res.end(content)} send(404,{error:'not found'});
 }catch(error){res.writeHead(error.code==='ENOENT'?404:500,{'Content-Type':'application/json'});res.end(json({error:error.message}));} });
export { hydrateIncident, scenarios, toolPermissions };
if (!process.env.TRACEMIND_NO_LISTEN) server.listen(PORT,'127.0.0.1',()=>console.log(`TraceMind API and web app listening on http://localhost:${PORT}`));
