let periodStart='';
let periodEnd='';
timeRange='today';
function periodBounds() {
  const today=PlannerTime.dateKey();
  if(timeRange==='today')return [today,today];
  if(timeRange==='3days')return [PlannerTime.addDays(today,-2),today];
  if(timeRange==='week')return [PlannerTime.monday(today),PlannerTime.addDays(PlannerTime.monday(today),6)];
  if(timeRange==='custom')return [periodStart,periodEnd];
  return ['',''];
}
function periodLabel() {
  return {today:'Heute',week:'Diese Woche',all:'Alle verfügbaren Gespräche','3days':'Letzte 3 Tage',custom:periodStart+' bis '+periodEnd}[timeRange];
}
function inSelectedPeriod(iso){const [start,end]=periodBounds();return PlannerTime.inRange(iso,start,end);}
function setRange(value) {
  const chosen=['today','3days','week','custom','all'].includes(value)?value:'today';
  if(chosen==='custom' && (!periodStart || !periodEnd)) {periodStart=PlannerTime.addDays(PlannerTime.dateKey(),-2);periodEnd=PlannerTime.dateKey();}
  timeRange=chosen;
  document.querySelectorAll('[data-period-select]').forEach(s=>s.value=timeRange);
  const custom=document.getElementById('period-custom');custom.classList.toggle('hidden',timeRange!=='custom');
  document.getElementById('period-start').value=periodStart;
  document.getElementById('period-end').value=periodEnd;
  render();
}
function applyCustomPeriod() {
  const start=document.getElementById('period-start').value,end=document.getElementById('period-end').value;
  const msg=document.getElementById('period-message');
  if(!start||!end||start>end){msg.textContent='Bitte einen gültigen Zeitraum wählen: Von liegt vor Bis.';return;}
  msg.textContent='';periodStart=start;periodEnd=end;render();
}
function renderPeriodInsights(items) {
  const open=items.filter(i=>!['done','live'].includes(i.info.key)).length;
  document.getElementById('ai-summary').textContent=items.length+' Anrufe im gewählten Zeitraum. '+open+' Anliegen daraus sind noch offen.';
  const topics={};items.forEach(i=>{const key=topicFromCall(i.call);topics[key]=(topics[key]||0)+1;});
  document.getElementById('ai-topics').innerHTML=topEntries(topics,4).map(([name,count])=>'<div class="insight-item"><strong>'+escHtml(name)+'</strong><span>'+count+'</span></div>').join('')||'<div class="empty">Keine Gespräche in diesem Zeitraum.</div>';
  document.getElementById('ai-recommendation').textContent=open?'Im Rückrufplan findest du die offenen Anliegen nach gewünschter Rückrufzeit.':'In diesem Zeitraum ist nichts mehr zu bearbeiten.';
}
function renderPeriodDays(items) {
  const groups={};items.forEach(i=>{const day=PlannerTime.dateKey(i.createdAt);if(day)groups[day]=(groups[day]||0)+1;});
  const [start,end]=periodBounds();
  if(start&&end)for(let day=start,n=0;day<=end&&n<60;day=PlannerTime.addDays(day,1),n++)if(!groups[day])groups[day]=0;
  const days=Object.keys(groups).sort().slice(-60),max=Math.max(1,...Object.values(groups));
  document.getElementById('analytics-days').innerHTML=days.map(day=>'<div class="bar-row"><div class="bar-top"><span>'+escHtml(day.slice(8,10)+'.'+day.slice(5,7)+'.')+'</span><span>'+groups[day]+'</span></div><div class="bar-track"><div class="bar-fill" style="width:'+Math.round(groups[day]/max*100)+'%"></div></div></div>').join('')||'<div class="empty">Keine Gespräche.</div>';
}
