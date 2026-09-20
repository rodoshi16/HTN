const $ = (s) => document.querySelector(s);
const humanize = (value) => value.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());
let incidentId = localStorage.getItem('tracemind-incident');

function notify(message) { const toast=$('#toast'); toast.textContent=message; toast.classList.add('show'); setTimeout(()=>toast.classList.remove('show'),2600); }
function renderTrace(tasks=[]) {
  $('#agentList').innerHTML = tasks.map(task => `<div class="agent-row"><div class="agent-icon"></div><div class="agent-info"><strong>${humanize(task.agent)}</strong><small>${humanize(task.kind)}</small></div><span class="trace-detail">${task.output_json ? 'evidence returned' : 'working'}</span><span class="agent-state ${task.status==='completed'?'done':''}">${humanize(task.status)}</span></div>`).join('');
  $('#progressCount').textContent = tasks.filter(t=>t.status==='completed').length;
}
function renderTimeline(timeline=[]) { $('#timelineList').innerHTML=timeline.map(e=>`<div class="timeline-row ${e.category==='impact'?'critical':''}"><div class="timeline-time">${e.occurred_at}</div><div class="timeline-pin"><i></i></div><div class="timeline-copy"><strong>${e.title}</strong><span>${e.detail}</span></div></div>`).join(''); }
function renderHypotheses(items=[]) { $('.hypothesis-list').innerHTML=items.slice(0,2).map((item,index)=>`<article class="hypothesis-item"><div class="hypothesis-head"><span class="rank">0${index+1}</span><div><h3>${item.title}</h3><p>${humanize(item.status)}</p></div><span class="support ${index===0?'strong':''}">${Math.round(item.confidence*100)}%</span></div><div class="support-bar ${index?'dim':''}"><i style="width:${Math.round(item.confidence*100)}%"></i></div><div class="hypo-meta"><span>${item.supporting_json?.length||0} supporting</span><span>${item.contradicting_json?.length||0} contradicting</span></div></article>`).join(''); }
function renderEvidence(evidence=[]) { if(!evidence.length) return; $('#evidenceRows').innerHTML=evidence.slice(0,5).map(e=>`<div><code>${e.id.toUpperCase()}</code><span>${e.kind.replaceAll('_',' ')} observed from ${e.source}</span><b>${e.source==='verification'?'RULES OUT':'SUPPORTS'}</b></div>`).join(''); }
function showApproval(state) {
  const action=state.actions?.find(a=>a.status==='pending_approval'); const button=$('#approveInline');
  button.disabled=!action; button.textContent=action?'APPROVE ROLLBACK':'NO ACTION PENDING';
  button.onclick=async()=>{ if(!action)return; button.disabled=true; button.textContent='EXECUTING…'; const response=await fetch(`/api/incidents/${incidentId}/approve`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({actionId:action.id})}); if(response.ok){notify('Rollback completed in the controlled simulation. Recovery verified.');refresh()} else notify('Approval could not be recorded.'); };
}
function render(state) {
  if(!state?.incident)return;
  $('.eyebrow').innerHTML=`<i></i> ${state.incident.status.replaceAll('_',' ').toUpperCase()} / ${state.incident.id}`;
  $('.incident-id h1').textContent=state.incident.title;
  $('#confidence').textContent=Math.round((state.incident.confidence||0)*100);
  const primary=state.hypotheses?.[0]; if(primary){$('#primaryTheory').textContent=primary.title;$('#briefTitle').textContent=`The evidence points to ${primary.title.toLowerCase()}.`;}
  renderTrace(state.tasks);renderTimeline(state.timeline);renderHypotheses(state.hypotheses);renderEvidence(state.evidence);showApproval(state);
  $('#waitingText').textContent=state.incident.status==='mitigated'?'Recovery verified by deployment and metrics agents':state.incident.status==='awaiting_approval'?'Commander decision required: rollback is prepared':'Specialists are independently collecting evidence';
}
async function refresh(){ if(!incidentId)return; const response=await fetch(`/api/incidents/${incidentId}`); if(response.ok)render(await response.json()); }
async function bootstrap(){
  try {
    if(incidentId){const existing=await fetch(`/api/incidents/${incidentId}`);const body=await existing.json();if(body.incident)render(body);else incidentId=null;}
    if(!incidentId){const response=await fetch('/api/incidents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenario:'connection_pool',title:'Checkout API errors'})}); const data=await response.json();incidentId=data.incidentId;localStorage.setItem('tracemind-incident',incidentId);notify('Incident room opened. Six specialist agents dispatched.');}
    const stream=new EventSource(`/api/incidents/${incidentId}/events`);['activity','finding','complete'].forEach(name=>stream.addEventListener(name,refresh));setTimeout(refresh,180);
  }catch(error){notify('Start the TraceMind server to open the live incident room.');}
}
$('#replayBtn').addEventListener('click',()=>{localStorage.removeItem('tracemind-incident');incidentId=null;location.reload();});
$('#askBtn').addEventListener('click',async()=>{const input=$('#askInput');if(!input.value.trim()||!incidentId)return;const response=await fetch(`/api/incidents/${incidentId}/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:input.value})});const data=await response.json();notify(data.reply||'The Incident Agent is reviewing your request.');input.value='';});
$('#askInput').addEventListener('keydown',(event)=>{if(event.key==='Enter')$('#askBtn').click();});
bootstrap();
