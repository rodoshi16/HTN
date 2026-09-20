const agents = [
  ['◫', 'Coordinator', 'Synthesizing investigation state', 'done'],
  ['⌁', 'Log agent', '14 findings · order-service', 'done'],
  ['⌁', 'Metrics agent', '8 anomalies · DB saturation', 'done'],
  ['◈', 'Deployment agent', '2 nearby changes identified', 'done'],
  ['⌘', 'Code agent', '1 suspicious config change', 'done'],
  ['◇', 'Infrastructure agent', 'Redis change investigated', 'done'],
  ['◐', 'Skeptic agent', 'Created verification task', 'done'],
  ['✓', 'Verification agent', 'Checking Redis behaviour', 'running']
];
const events = [
  ['14:09', 'Redis configuration changed', 'cache maxmemory-policy updated', ''],
  ['14:10', 'Version 4.8.2 deployed', 'connection-pool configuration modified', 'primary'],
  ['14:12', 'Database connections increased 480%', '40 → 240 active connections', 'primary'],
  ['14:13', 'PostgreSQL latency increased 230%', 'p95: 48ms → 159ms', 'primary'],
  ['14:14', 'API timeouts spiked', 'order-service +410%', 'critical'],
  ['14:15', 'HTTP 500 error rate increased 430%', 'API gateway alert opened', 'critical'],
  ['14:16', 'Checkout failures detected', 'Customer impact confirmed', 'critical']
];
const evidence = {
  deploy: ['DEP-482', 'Deployment v4.8.2 completed at 14:10, four minutes before API timeout onset.'],
  config: ['CODE-991', 'The deployment diff raised db.pool.maxConnections from 50 to 250.'],
  connections: ['MET-112', 'PostgreSQL active connections rose from 40 to 240 starting at 14:12.'],
  timeout: ['LOG-1832', 'Order API timeout errors rose 410% after database latency increased.']
};
const list = document.getElementById('agentList');
const dots = document.getElementById('agentDots');
const timeline = document.getElementById('timelineList');
const toast = document.getElementById('toast');
let verificationComplete = false;
function renderAgents(){
  list.innerHTML = agents.map(([icon,name,detail,state]) => `<div class="agent-row"><div class="agent-icon">${icon}</div><div class="agent-info"><strong>${name}</strong><small>${detail}</small></div><span class="agent-state ${state}">${state === 'done' ? 'Complete' : '<i class="running-dot"></i>Running'}</span></div>`).join('');
  dots.innerHTML = agents.map((a,i)=>`<i ${i === 7 && !verificationComplete ? '' : 'style="background:#45a685;outline:0"'}></i>`).join('');
}
function renderTimeline(){timeline.innerHTML=events.map(([time,title,detail,state])=>`<div class="timeline-row ${state}"><div class="timeline-time">${time}</div><div class="timeline-pin"><i></i></div><div class="timeline-copy"><strong>${title}</strong><span>${detail}</span></div></div>`).join('')}
function notify(message){toast.textContent=message;toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),2600)}
function completeVerification(){
  if(verificationComplete) return;
  verificationComplete=true;
  agents[7][2]='Redis latency and errors remained baseline';agents[7][3]='done';
  document.getElementById('progressCount').textContent='8';
  document.getElementById('waitingText').textContent='All evidence sources reviewed';
  document.getElementById('skepticTitle').textContent='Redis behaviour verified — primary cause unlikely';
  renderAgents();notify('Verification complete: Redis is unlikely to be the primary cause.');
}
document.querySelectorAll('.evidence-chip').forEach(btn=>btn.addEventListener('click',()=>{const [id,text]=evidence[btn.dataset.evidence];document.getElementById('graphDetail').innerHTML=`<span class="detail-dot"></span><div><small>SELECTED EVIDENCE</small><strong>${text}</strong></div><code>${id}</code>`;document.getElementById('graph').scrollIntoView({behavior:'smooth',block:'center'})}));
document.getElementById('inspectEvidence').addEventListener('click',()=>document.getElementById('graph').scrollIntoView({behavior:'smooth'}));
document.getElementById('skepticBtn').addEventListener('click',completeVerification);
document.getElementById('replayBtn').addEventListener('click',()=>{notify('Replaying investigation trace from coordinator…');setTimeout(completeVerification,1200)});
document.getElementById('failureToggle').addEventListener('click',function(){const failed=this.classList.toggle('active');this.textContent=failed?'Restore metrics source':'Simulate source failure';if(failed){agents[2][2]='Source unavailable · alternate evidence used';agents[2][3]='running';notify('Metrics source unavailable. Coordinator is using logs and deploy evidence.')}else{agents[2][2]='8 anomalies · DB saturation';agents[2][3]='done';notify('Metrics source restored. Evidence coverage recovered.')}renderAgents()});
renderAgents();renderTimeline();

// Live workspace integration. When served by TraceMind, this follows the
// persisted incident and streamed agent state rather than static demo content.
const humanize = value => value.replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
function renderLive(state) {
  if (!state?.incident) return;
  document.querySelector('.eyebrow').innerHTML = `<span class="pulse"></span> ${state.incident.status.replaceAll('_',' ')} <span class="divider">/</span> ${state.incident.id}`;
  document.querySelector('.title-row h1').textContent = state.incident.title;
  const taskByAgent = state.tasks.filter((t,i,a)=>a.findIndex(x=>x.agent===t.agent)===i);
  list.innerHTML = taskByAgent.map(t => `<div class="agent-row"><div class="agent-icon">◌</div><div class="agent-info"><strong>${humanize(t.agent)}</strong><small>${t.kind.replaceAll('_',' ')}</small></div><span class="agent-state ${t.status==='completed'?'done':'running'}">${t.status==='completed'?'Complete':`<i class="running-dot"></i>${humanize(t.status)}`}</span></div>`).join('');
  document.getElementById('progressCount').textContent = state.tasks.filter(t=>t.status==='completed').length;
  document.getElementById('waitingText').textContent = state.incident.status==='mitigated'?'Recovery verified in simulation':state.incident.status==='awaiting_approval'?'Remediation is waiting for approval':'Investigation in progress';
  timeline.innerHTML = state.timeline.map(e=>`<div class="timeline-row ${e.category==='impact'?'critical':e.category==='deployment'||e.category==='database'?'primary':''}"><div class="timeline-time">${e.occurred_at}</div><div class="timeline-pin"><i></i></div><div class="timeline-copy"><strong>${e.title}</strong><span>${e.detail}</span></div></div>`).join('');
  const hypotheses = state.hypotheses;
  if (hypotheses.length) document.querySelector('.hypothesis-list').innerHTML = hypotheses.slice(0,2).map((h,i)=>`<article class="hypothesis-item ${i===0?'selected':''}"><div class="hypothesis-head"><span class="rank">0${i+1}</span><div><h3>${h.title}</h3><p>${h.status.replaceAll('_',' ')}</p></div><span class="support ${i===0?'strong':'weak'}">${Math.round(h.confidence*100)}%</span></div><div class="support-bar ${i?'dim':''}"><i style="width:${Math.round(h.confidence*100)}%"></i></div><div class="hypo-meta"><span>${h.supporting_json?.length||0} supporting signals</span><span>${h.contradicting_json?.length||0} counter-signals</span></div></article>`).join('');
  const pending = state.actions?.find(a=>a.status==='pending_approval');
  if (pending) showApproval(state, pending);
}
function showApproval(state, action) {
  if (document.getElementById('approvalCard')) return;
  const card=document.createElement('div'); card.id='approvalCard'; card.className='approval-card';
  card.innerHTML=`<div><span class="section-kicker">REMEDIATION REQUIRES APPROVAL</span><h3>Rollback ${action.target}</h3><p>${action.payload_json.from} → ${action.payload_json.to}. ${action.payload_json.reason}</p></div><div><button class="secondary-btn" type="button">Dismiss</button><button class="primary-btn" type="button">Approve rollback</button></div>`;
  document.querySelector('.investigation-panel').append(card);
  card.querySelector('.secondary-btn').onclick=()=>card.remove();
  card.querySelector('.primary-btn').onclick=async()=>{card.querySelector('.primary-btn').disabled=true; await fetch(`/api/incidents/${state.incident.id}/approve`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({actionId:action.id})});card.remove();refreshLive();notify('Rollback approved — executing in the controlled simulator.');};
}
let liveIncident;
async function refreshLive(){if(!liveIncident)return;const r=await fetch(`/api/incidents/${liveIncident}`);if(r.ok)renderLive(await r.json())}
async function bootstrapLive() {
  try {
    liveIncident=localStorage.getItem('tracemind-incident');
    if(liveIncident){const check=await fetch(`/api/incidents/${liveIncident}`);const state=await check.json();if(!state.incident)liveIncident=null;else renderLive(state)}
    if(!liveIncident){const r=await fetch('/api/incidents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenario:'connection_pool',title:'Checkout API errors'})});const created=await r.json();liveIncident=created.incidentId;localStorage.setItem('tracemind-incident',liveIncident);notify('Incident created. Agents are collecting evidence.');}
    const stream=new EventSource(`/api/incidents/${liveIncident}/events`);stream.addEventListener('activity',refreshLive);stream.addEventListener('finding',refreshLive);stream.addEventListener('complete',refreshLive);setTimeout(refreshLive,250);
  } catch { /* Static fallback works when opened directly from disk. */ }
}
bootstrapLive();
