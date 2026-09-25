(() => {
  const STORAGE_KEY = 'firstseen-browser-crm-v2-0';
  const CALL_SCRIPT_STORE_KEY = 'firstseen-browser-crm-call-scripts-v2';
  const STATUS = ['Uncontacted','Attempted','Spoke To','Follow Up','Meeting Booked','Quote Sent','Won','Lost'];
  const STATUS_COLORS = {
    'Uncontacted':['#e8eaf2','#536078'],'Attempted':['#fff1d6','#9a6514'],'Spoke To':['#e8f1ff','#2864aa'],'Follow Up':['#f2eaff','#7047a9'],
    'Meeting Booked':['#e6f7ef','#168a5b'],'Quote Sent':['#e9ecff','#4f59c8'],'Won':['#dff7ea','#08784b'],'Lost':['#ffe6e6','#b94444']
  };


  const state = loadState();
  state.contactIntent = Array.isArray(state.contactIntent) ? state.contactIntent : [];
  state.settings = state.settings && typeof state.settings === 'object' ? state.settings : {workspace:'FirstSeen Digital',owner:'Harvey',browserCalling:true,supabase:false,twilio:false};
  let outreachMessageSettings = {
    website:String(state.settings.outreachWebsite||''),
    email:String(state.settings.outreachEmail||'hello@firstseendigital.com.au')
  };
  const connection = { mode:'standalone', connected:false, label:'Standalone · waiting for Desktop', desktopVersion:'', twilio:false, twilioConfigured:false };
  const cloud = { url:'', key:'', configured:false, client:null, sdkPromise:null, signedIn:false, userEmail:'', leadCount:null, leadNames:[], status:'Supabase not configured yet', error:'' };
  const syncPreview = { running:false, ran:false, localCount:0, cloudCount:0, matched:0, matchedWithDifferences:0, localOnly:0, cloudOnly:0, possibleDuplicates:0, localOnlyNames:[], cloudOnlyNames:[], differenceNames:[], duplicateNames:[], error:'' };
  const cloudSync = { running:false, enabled:true, status:'Waiting for Supabase sign-in', error:'', lastAt:'', uploaded:0, downloaded:0, updatedCloud:0, updatedDesktop:0, conflicts:0, timer:null };
  const voice = { sdkPromise:null, device:null, call:null, state:'idle', error:'', muted:false, keypad:false, connectedAt:null, lastCallSid:'', tokenExpiresAt:0, callerId:'', identity:'', countryCode:'+61', edge:'roaming' };
  let activeView = 'leads';
  let activeLeadId = null;
  let drawerTab = 'overview';
  let callLeadId = null;
  let scriptLeadId = null;
  let callStart = null;
  let callTimer = null;
  let callScriptPanelOpen = false;
  let callScriptModel = null;
  let callScriptSavedModel = null;
  let callScriptSaveSource = 'default';
  let callScriptDirty = false;
  let callScriptSaving = false;
  let boardFilter = 'Open';

  const el = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const nowIsoLocal = () => { const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,16); };
  const money = n => new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD',maximumFractionDigits:0}).format(Number(n||0));
  const fmtDate = v => !v ? '—' : new Date(v).toLocaleString('en-AU',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'});
  const isOpen = l => !['Won','Lost'].includes(l.status);

  function loadState(){
    try{const raw=localStorage.getItem(STORAGE_KEY); if(raw) return JSON.parse(raw);}catch(e){}
    return {leads:[],contactIntent:[],events:[],settings:{workspace:'FirstSeen Digital',owner:'Harvey',browserCalling:true,supabase:false,twilio:false}};
  }
  function save(){
    // When the page is opened by FirstSeen Desktop, SQLite is the source of truth.
    // Only standalone/browser-only data is persisted locally.
    if(connection.mode!=='desktop') localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
  }
  function logEvent(lead,type,text){lead.activities=lead.activities||[];lead.activities.unshift({type,text,at:nowIsoLocal()});state.events.unshift({leadId:lead.id,type,text,at:nowIsoLocal()});save();}
  async function api(path, options={}){
    const response=await fetch(path,{cache:'no-store',headers:{'Content-Type':'application/json',...(options.headers||{})},...options});
    let body={}; try{body=await response.json();}catch{}
    if(!response.ok) throw new Error(body.error||body.message||`Request failed (${response.status})`);
    return body;
  }
  function mapDesktopLead(x){
    return {
      id:x.id,business:x.business||x.name||'',phone:x.phone||'',email:x.email||x.businessEmail||'',website:x.website||'',
      suburb:x.suburb||x.area||'',address:x.address||'',category:x.category||x.industry||'',source:x.source||'Desktop',
      score:Number(x.score||0),status:x.status||x.salesStage||'Uncontacted',websiteQuality:x.websiteQuality||x.websiteStatus||(!x.website?'No website':'Website'),
      rating:Number(x.rating||0)||null,reviews:Number(x.reviews||0),value:Number(x.value||0),nextFollowUp:x.nextFollowUp||x.followUpDate||'',
      lastContacted:x.lastContacted||'',notes:x.notes||'',businessSummary:x.businessSummary||'',contact:x.contact||'',createdAt:x.createdAt||'',updatedAt:x.updatedAt||x.updated_at||'',googlePlaceId:x.googlePlaceId||'',
      googleMapsUrl:x.googleMapsUrl||x.googleMapsUri||'',businessStatus:x.businessStatus||'',openNow:typeof x.openNow==='boolean'?x.openNow:null,
      openingHours:x.openingHours&&typeof x.openingHours==='object'?x.openingHours:{},serviceAreaBusiness:Boolean(x.serviceAreaBusiness||x.pureServiceAreaBusiness),
      utcOffsetMinutes:Number.isFinite(Number(x.utcOffsetMinutes))?Number(x.utcOffsetMinutes):null,auditScore:Number(x.auditScore||0),
      auditReasons:Array.isArray(x.auditReasons)?x.auditReasons:[],emailSourceUrl:x.emailSourceUrl||'',activities:Array.isArray(x.activities)?x.activities:[]
    };
  }

  function mapContactIntent(x){
    return {
      id:x.id||`google:${x.googlePlaceId||''}`,kind:'google-shortlist',wantToContact:true,discoveryDecision:'liked',
      business:x.business||x.name||'Finder lead',phone:x.phone||'',email:x.email||'',website:x.website||'',suburb:x.suburb||x.area||'',address:x.address||'',
      category:x.category||x.industry||'',source:'Find Businesses',score:Number(x.score||0),status:x.contactedAt?'Attempted':'Uncontacted',websiteQuality:x.websiteQuality||(!x.website?'No website':'Website'),
      rating:Number(x.rating||0)||null,reviews:Number(x.reviews||0),value:0,nextFollowUp:'',lastContacted:x.contactedAt||'',notes:'',contact:'',createdAt:x.createdAt||'',
      googlePlaceId:x.googlePlaceId||'',googleMapsUrl:x.googleMapsUrl||'',businessStatus:x.businessStatus||'',openNow:typeof x.openNow==='boolean'?x.openNow:null,
      openingHours:x.openingHours&&typeof x.openingHours==='object'?x.openingHours:{},serviceAreaBusiness:Boolean(x.serviceAreaBusiness),utcOffsetMinutes:Number.isFinite(Number(x.utcOffsetMinutes))?Number(x.utcOffsetMinutes):null,
      auditScore:Number(x.auditScore||0),auditReasons:Array.isArray(x.auditReasons)?x.auditReasons:[],emailSourceUrl:x.emailSourceUrl||'',contactedAt:x.contactedAt||'',activities:[]
    };
  }

  async function refreshDesktopData({quiet=false}={}){
    try{
      const status=await api('/api/status');
      if(status?.source!=='firstseen-desktop') throw new Error('Desktop bridge unavailable.');
      const [result,intentResult]=await Promise.all([api('/api/leads'),api('/api/contact-intent')]);
      state.leads=(result.leads||[]).map(mapDesktopLead);
      state.contactIntent=(intentResult.leads||[]).map(mapContactIntent);
      state.events=[];
      connection.mode='desktop'; connection.connected=true; connection.desktopVersion=status.version||''; connection.label=`Connected to FirstSeen Desktop${status.version?' V'+status.version:''}`; connection.twilio=Boolean(status.twilioVoiceConfigured); connection.twilioConfigured=connection.twilio; state.settings.twilio=connection.twilio;
      if(!quiet) render();
      return true;
    }catch(error){
      connection.mode='standalone'; connection.connected=false; connection.label='Standalone · Desktop not connected';
      if(!quiet) render();
      return false;
    }
  }
  async function refreshIntegrationStatus(){
    try{
      const response=await fetch('/api/integrations-status',{cache:'no-store'});
      if(!response.ok)return false;
      const status=await response.json();
      connection.twilio=Boolean(status.twilioVoiceConfigured); connection.twilioConfigured=connection.twilio; state.settings.twilio=connection.twilio; state.settings.supabase=Boolean(status.supabaseConfigured); cloud.configured=Boolean(status.supabaseConfigured||cloud.configured);
      if(status.twilioCountryCode) voice.countryCode=status.twilioCountryCode;
      if(status.twilioCallerId) voice.callerId=status.twilioCallerId;
      if(status.twilioIdentity) voice.identity=status.twilioIdentity;
      if(status.twilioEdge) voice.edge=status.twilioEdge;
      return true;
    }catch{return false;}
  }

  async function refreshSupabaseConfig(){
    let next={url:'',key:'',configured:false};
    if(connection.mode==='desktop'){
      try{next=await api('/api/supabase-config');}catch{}
    }else{
      next={url:String(state.settings.supabaseUrl||''),key:String(state.settings.supabaseKey||''),configured:Boolean(state.settings.supabaseUrl&&state.settings.supabaseKey)};
    }
    const nextUrl=String(next.url||'').trim().replace(/\/$/,'');
    const nextKey=String(next.key||'').trim();
    const changed=cloud.url!==nextUrl||cloud.key!==nextKey;
    cloud.url=nextUrl;cloud.key=nextKey;cloud.configured=Boolean(next.configured||cloud.url&&cloud.key);state.settings.supabase=cloud.configured;
    if(changed){cloud.client=null;cloud.signedIn=false;cloud.userEmail='';cloud.leadCount=null;cloud.leadNames=[];}
    return cloud.configured;
  }
  async function saveSupabaseConfig(url,key){
    const next={url:String(url||'').trim().replace(/\/$/,''),key:String(key||'').trim()};
    if(!/^https:\/\//i.test(next.url))throw new Error('Enter the Supabase Project URL beginning with https://.');
    if(/service_role|secret/i.test(next.key)||!/^sb_publishable_/i.test(next.key))throw new Error('Use the Supabase publishable key (sb_publishable_…), not a secret/service-role key.');
    if(connection.mode==='desktop')await api('/api/supabase-config',{method:'POST',body:JSON.stringify(next)});
    else{state.settings.supabaseUrl=next.url;state.settings.supabaseKey=next.key;state.settings.supabase=true;save();}
    cloud.url=next.url;cloud.key=next.key;cloud.configured=true;cloud.client=null;cloud.error='';cloud.status='Connection saved · sign in with GitHub';state.settings.supabase=true;
    return next;
  }
  async function ensureSupabaseSdk(){
    if(window.supabase&&typeof window.supabase.createClient==='function')return window.supabase;
    if(cloud.sdkPromise)return cloud.sdkPromise;
    cloud.sdkPromise=new Promise((resolve,reject)=>{
      const urls=['https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2','https://unpkg.com/@supabase/supabase-js@2'];
      let i=0;const tryNext=()=>{
        if(i>=urls.length)return reject(new Error('Could not load the Supabase browser SDK. Check your internet connection.'));
        const script=document.createElement('script');script.src=urls[i++];script.async=true;
        script.onload=()=>window.supabase&&typeof window.supabase.createClient==='function'?resolve(window.supabase):(script.remove(),tryNext());
        script.onerror=()=>{script.remove();tryNext();};document.head.appendChild(script);
      };tryNext();
    });
    return cloud.sdkPromise;
  }
  async function ensureSupabaseClient(){
    await refreshSupabaseConfig();
    if(!cloud.configured)throw new Error('Save your Supabase Project URL and publishable key first.');
    if(cloud.client)return cloud.client;
    const sdk=await ensureSupabaseSdk();
    cloud.client=sdk.createClient(cloud.url,cloud.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:'firstseen-supabase-auth-v1'}});
    return cloud.client;
  }
  async function refreshCloudConnection({fetchLeads=false}={}){
    cloud.error='';
    try{
      await refreshSupabaseConfig();
      if(!cloud.configured){cloud.signedIn=false;cloud.userEmail='';cloud.leadCount=null;cloud.leadNames=[];cloud.status='Supabase not configured yet';return false;}
      const client=await ensureSupabaseClient();
      const {data,error}=await client.auth.getSession();if(error)throw error;
      const session=data?.session||null;cloud.signedIn=Boolean(session);cloud.userEmail=session?.user?.email||'';
      if(!session){cloud.leadCount=null;cloud.leadNames=[];cloud.status='Connection saved · sign in with GitHub';return false;}
      cloud.status=`Signed in${cloud.userEmail?` as ${cloud.userEmail}`:''}`;
      if(fetchLeads){
        const result=await client.from('leads').select('id,business_name,status,updated_at',{count:'exact'}).order('updated_at',{ascending:false}).limit(10);
        if(result.error)throw result.error;
        cloud.leadCount=Number(result.count||0);cloud.leadNames=(result.data||[]).map(x=>x.business_name).filter(Boolean);
        cloud.status=`Connected · ${cloud.leadCount} cloud lead${cloud.leadCount===1?'':'s'} visible`;
      }
      return true;
    }catch(error){cloud.error=error.message||'Cloud connection failed.';cloud.status=cloud.error;return false;}
  }
  async function signInSupabase(){
    if(!/^https?:$/i.test(location.protocol))throw new Error('Open Browser CRM from FirstSeen Desktop to sign in with GitHub.');
    const client=await ensureSupabaseClient();
    const redirectTo=`${location.origin}/`;
    const {error}=await client.auth.signInWithOAuth({provider:'github',options:{redirectTo}});if(error)throw error;
  }
  async function signOutSupabase(){
    const client=await ensureSupabaseClient();const {error}=await client.auth.signOut();if(error)throw error;
    cloud.signedIn=false;cloud.userEmail='';cloud.leadCount=null;cloud.leadNames=[];cloud.status='Signed out';cloud.error='';cloudSync.status='Signed out';
  }

  function syncNorm(value){return String(value||'').trim().toLowerCase().replace(/\s+/g,' ');}
  function syncDigits(value){return String(value||'').replace(/\D/g,'').replace(/^61(?=\d{9}$)/,'0');}
  function syncEmail(value){return String(value||'').trim().toLowerCase();}
  function syncHost(value){try{const raw=String(value||'').trim();if(!raw)return '';const u=new URL(/^https?:\/\//i.test(raw)?raw:`https://${raw}`);return u.hostname.toLowerCase().replace(/^www\./,'');}catch{return '';}}
  function syncIdentityScore(local,cloudLead){
    let score=0;
    const lg=syncNorm(local.googlePlaceId),cg=syncNorm(cloudLead.google_place_id);
    const lp=syncDigits(local.phone),cp=syncDigits(cloudLead.phone);
    const le=syncEmail(local.email),ce=syncEmail(cloudLead.email);
    const lw=syncHost(local.website),cw=syncHost(cloudLead.website);
    const ln=syncNorm(local.business),cn=syncNorm(cloudLead.business_name);
    const ls=syncNorm(local.suburb),cs=syncNorm(cloudLead.suburb);
    if(lg&&cg&&lg===cg) score+=500;
    if(lp&&cp&&lp===cp) score+=350;
    if(le&&ce&&le===ce) score+=350;
    if(lw&&cw&&lw===cw) score+=220;
    if(ln&&cn&&ln===cn) score+=120;
    if(ls&&cs&&ls===cs) score+=40;
    return score;
  }
  function syncLeadDiffs(local,cloudLead){
    const fields=[
      ['business',local.business,cloudLead.business_name],['phone',syncDigits(local.phone),syncDigits(cloudLead.phone)],['email',syncEmail(local.email),syncEmail(cloudLead.email)],
      ['website',syncHost(local.website),syncHost(cloudLead.website)],['suburb',local.suburb,cloudLead.suburb],['business type',local.category,cloudLead.business_type],
      ['status',local.status,cloudLead.status],['summary',local.businessSummary,cloudLead.business_summary],['notes',local.notes,cloudLead.notes],
      ['last contacted',String(local.lastContacted||'').slice(0,10),String(cloudLead.last_contacted||'').slice(0,10)],['follow-up',String(local.nextFollowUp||'').slice(0,10),String(cloudLead.next_follow_up||'').slice(0,10)]
    ];
    return fields.filter(([,a,b])=>{const aa=syncNorm(a),bb=syncNorm(b);return aa&&bb&&aa!==bb;}).map(([name])=>name);
  }
  function buildSyncPreview(localLeads,cloudLeads){
    const local=(localLeads||[]).filter(l=>l&&l.kind!=='google-shortlist');
    const cloudRows=Array.isArray(cloudLeads)?cloudLeads:[];
    const candidates=[];
    local.forEach((l,li)=>cloudRows.forEach((c,ci)=>{const score=syncIdentityScore(l,c);if(score>=120)candidates.push({li,ci,score});}));
    candidates.sort((a,b)=>b.score-a.score);
    const usedL=new Set(),usedC=new Set(),pairs=[];
    for(const c of candidates){if(usedL.has(c.li)||usedC.has(c.ci))continue;usedL.add(c.li);usedC.add(c.ci);pairs.push(c);}
    const diffs=[];
    for(const pair of pairs){const l=local[pair.li],c=cloudRows[pair.ci],fields=syncLeadDiffs(l,c);if(fields.length)diffs.push(`${l.business} (${fields.slice(0,3).join(', ')}${fields.length>3?'…':''})`);}
    const localOnly=local.filter((_,i)=>!usedL.has(i));
    const cloudOnly=cloudRows.filter((_,i)=>!usedC.has(i));
    const duplicateNames=[];
    for(const l of localOnly){for(const c of cloudOnly){if(syncNorm(l.business)&&syncNorm(l.business)===syncNorm(c.business_name)){duplicateNames.push(`${l.business} — same name, identity not confirmed`);break;}}}
    return {ran:true,running:false,error:'',localCount:local.length,cloudCount:cloudRows.length,matched:pairs.length,matchedWithDifferences:diffs.length,localOnly:localOnly.length,cloudOnly:cloudOnly.length,possibleDuplicates:duplicateNames.length,localOnlyNames:localOnly.slice(0,6).map(x=>x.business),cloudOnlyNames:cloudOnly.slice(0,6).map(x=>x.business_name).filter(Boolean),differenceNames:diffs.slice(0,6),duplicateNames:duplicateNames.slice(0,6)};
  }
  async function previewCloudSync(){
    syncPreview.running=true;syncPreview.error='';render();
    try{
      if(connection.mode!=='desktop')throw new Error('Open Browser CRM from FirstSeen Desktop before previewing sync.');
      const client=await ensureSupabaseClient();
      const {data:sessionData,error:sessionError}=await client.auth.getSession();if(sessionError)throw sessionError;if(!sessionData?.session)throw new Error('Sign in with GitHub first.');
      const result=await client.from('leads').select('id,business_name,phone,email,website,suburb,business_type,status,business_summary,notes,google_place_id,last_contacted,next_follow_up,created_at,updated_at').order('updated_at',{ascending:false}).limit(5000);
      if(result.error)throw result.error;
      Object.assign(syncPreview,buildSyncPreview(state.leads,result.data||[]));
    }catch(error){syncPreview.running=false;syncPreview.error=error.message||'Could not preview sync.';}
    render();
  }
  function syncPreviewHtml(){
    if(syncPreview.error)return `<div class="sync-preview-state danger">${esc(syncPreview.error)}</div>`;
    if(!syncPreview.ran)return '<div class="tiny">No sync preview has been run yet. Preview is read-only and changes nothing in SQLite or Supabase.</div>';
    const row=(label,value,detail='')=>`<div class="sync-preview-row"><span>${esc(label)}</span><strong>${value}</strong>${detail?`<small>${esc(detail)}</small>`:''}</div>`;
    const sample=(title,names)=>names&&names.length?`<div class="sync-preview-sample"><b>${esc(title)}</b><span>${names.map(esc).join(' · ')}</span></div>`:'';
    return `<div class="sync-preview-grid">${row('Desktop leads',syncPreview.localCount)}${row('Cloud leads',syncPreview.cloudCount)}${row('Matched',syncPreview.matched)}${row('Matched with differences',syncPreview.matchedWithDifferences)}${row('Desktop only',syncPreview.localOnly)}${row('Cloud only',syncPreview.cloudOnly)}${row('Possible duplicates',syncPreview.possibleDuplicates)}</div>${sample('Desktop only',syncPreview.localOnlyNames)}${sample('Cloud only',syncPreview.cloudOnlyNames)}${sample('Differences',syncPreview.differenceNames)}${sample('Needs review',syncPreview.duplicateNames)}`;
  }
  const CLOUD_LEAD_FIELDS='id,user_id,business_name,contact_name,phone,email,website,address,suburb,business_type,source,status,business_summary,notes,google_place_id,google_maps_url,google_rating,google_review_count,website_audit,opening_hours,service_area,last_contacted,next_follow_up,created_at,updated_at';
  function cloudMeta(row){const audit=row&&row.website_audit&&typeof row.website_audit==='object'?row.website_audit:{};return audit.firstseen&&typeof audit.firstseen==='object'?audit.firstseen:{};}
  function mapCloudLead(row){
    const meta=cloudMeta(row),audit=row&&row.website_audit&&typeof row.website_audit==='object'?row.website_audit:{};const rawStatus=String(row.status||'Uncontacted'),status=STATUS.includes(rawStatus)?rawStatus:(rawStatus==='Lead'?'Uncontacted':'Uncontacted');
    return {
      id:row.id,business:row.business_name||'',phone:row.phone||'',email:row.email||'',website:row.website||'',suburb:row.suburb||'',address:row.address||'',category:row.business_type||'',source:row.source||'Supabase',
      score:Number(meta.score||audit.score||0),status,websiteQuality:meta.websiteQuality||(!row.website?'No website':'Website'),rating:Number(row.google_rating||0)||null,reviews:Number(row.google_review_count||0),value:Number(meta.value||0),
      nextFollowUp:row.next_follow_up||'',lastContacted:row.last_contacted||'',notes:row.notes||'',businessSummary:row.business_summary||'',contact:row.contact_name||'',createdAt:row.created_at||'',updatedAt:row.updated_at||'',googlePlaceId:row.google_place_id||'',googleMapsUrl:row.google_maps_url||'',
      businessStatus:meta.businessStatus||'',openNow:typeof meta.openNow==='boolean'?meta.openNow:null,openingHours:row.opening_hours&&typeof row.opening_hours==='object'?row.opening_hours:{},serviceAreaBusiness:Boolean(meta.serviceAreaBusiness||row.service_area),utcOffsetMinutes:Number.isFinite(Number(meta.utcOffsetMinutes))?Number(meta.utcOffsetMinutes):null,
      auditScore:Number(meta.auditScore||audit.score||0),auditReasons:Array.isArray(meta.auditReasons)?meta.auditReasons:(Array.isArray(audit.reasons)?audit.reasons:[]),emailSourceUrl:meta.emailSourceUrl||'',activities:Array.isArray(meta.activities)?meta.activities:[],kind:'cloud'
    };
  }
  function desktopToCloud(lead, existing=null){
    const previous=existing&&existing.website_audit&&typeof existing.website_audit==='object'?existing.website_audit:{};
    const firstseen={...(previous.firstseen&&typeof previous.firstseen==='object'?previous.firstseen:{}),score:Number(lead.score||0),value:Number(lead.value||0),websiteQuality:lead.websiteQuality||'',businessStatus:lead.businessStatus||'',openNow:typeof lead.openNow==='boolean'?lead.openNow:null,serviceAreaBusiness:Boolean(lead.serviceAreaBusiness),utcOffsetMinutes:Number.isFinite(Number(lead.utcOffsetMinutes))?Number(lead.utcOffsetMinutes):null,auditScore:Number(lead.auditScore||0),auditReasons:Array.isArray(lead.auditReasons)?lead.auditReasons:[],emailSourceUrl:lead.emailSourceUrl||'',activities:Array.isArray(lead.activities)?lead.activities.slice(0,50):[]};
    return {
      id:lead.id,business_name:String(lead.business||'').trim(),contact_name:lead.contact||existing?.contact_name||null,phone:lead.phone||null,email:lead.email||null,website:lead.website||null,address:(lead.address&&lead.address!==lead.suburb?lead.address:null)||existing?.address||lead.address||null,suburb:lead.suburb||null,business_type:lead.category||null,source:lead.source||existing?.source||'FirstSeen Desktop',status:lead.status||'Uncontacted',business_summary:lead.businessSummary||null,notes:lead.notes||null,
      google_place_id:lead.googlePlaceId||existing?.google_place_id||null,google_maps_url:lead.googleMapsUrl||existing?.google_maps_url||null,google_rating:lead.rating===null||lead.rating===undefined?existing?.google_rating??null:Number(lead.rating),google_review_count:Number.isFinite(Number(lead.reviews))?Number(lead.reviews):(existing?.google_review_count??null),
      website_audit:{...previous,score:Number(lead.auditScore||previous.score||0),reasons:Array.isArray(lead.auditReasons)&&lead.auditReasons.length?lead.auditReasons:(Array.isArray(previous.reasons)?previous.reasons:[]),firstseen},opening_hours:lead.openingHours&&typeof lead.openingHours==='object'&&Object.keys(lead.openingHours).length?lead.openingHours:(existing?.opening_hours||{}),service_area:lead.serviceAreaBusiness?'Service area business':(existing?.service_area||null),last_contacted:lead.lastContacted||null,next_follow_up:lead.nextFollowUp||null,updated_at:new Date().toISOString()
    };
  }
  async function fetchCloudLeads(client){
    const result=await client.from('leads').select(CLOUD_LEAD_FIELDS).order('updated_at',{ascending:false}).limit(5000);
    if(result.error)throw result.error;return result.data||[];
  }
  async function upsertLeadToCloud(lead,existing=null){
    if(!cloud.signedIn)return null;
    const client=await ensureSupabaseClient();
    if(!existing&&lead?.id){const current=await client.from('leads').select(CLOUD_LEAD_FIELDS).eq('id',lead.id).maybeSingle();if(current.error)throw current.error;existing=current.data||null;}
    const payload=desktopToCloud(lead,existing);
    if(!payload.business_name)throw new Error('Business name is required before syncing.');
    const result=await client.from('leads').upsert(payload,{onConflict:'id'}).select(CLOUD_LEAD_FIELDS).single();if(result.error)throw result.error;return result.data;
  }
  async function patchCloudLead(id,patch){
    const client=await ensureSupabaseClient();
    const map={business:'business_name',contact:'contact_name',phone:'phone',email:'email',website:'website',address:'address',suburb:'suburb',category:'business_type',source:'source',status:'status',businessSummary:'business_summary',notes:'notes',googlePlaceId:'google_place_id',googleMapsUrl:'google_maps_url',rating:'google_rating',reviews:'google_review_count',lastContacted:'last_contacted',nextFollowUp:'next_follow_up'};
    const update={updated_at:new Date().toISOString()};for(const [k,v] of Object.entries(patch||{})){if(map[k])update[map[k]]=v||null;}
    const result=await client.from('leads').update(update).eq('id',id).select(CLOUD_LEAD_FIELDS).single();if(result.error)throw result.error;return result.data;
  }
  async function insertCloudLeadFromInput(input){
    const client=await ensureSupabaseClient();const now=new Date().toISOString();const id=(globalThis.crypto&&crypto.randomUUID)?crypto.randomUUID():`00000000-0000-4000-8000-${String(Date.now()).padStart(12,'0').slice(-12)}`;
    const lead={id,business:input.business,phone:input.phone,email:input.email,website:input.website,suburb:input.suburb,address:input.address||'',category:input.category,source:input.source||'Browser CRM',score:Number(input.score||70),status:'Uncontacted',websiteQuality:input.website?'Website':'No website',rating:null,reviews:0,value:Number(input.value||0),nextFollowUp:'',lastContacted:'',notes:input.notes||'',businessSummary:input.businessSummary||autoBusinessSummary(input),contact:'',createdAt:now,updatedAt:now,googlePlaceId:'',googleMapsUrl:'',openingHours:{},serviceAreaBusiness:false,auditScore:0,auditReasons:[],activities:[]};
    const payload=desktopToCloud(lead);payload.created_at=now;const result=await client.from('leads').insert(payload).select(CLOUD_LEAD_FIELDS).single();if(result.error)throw result.error;return result.data;
  }
  async function mirrorCloudLeadToDesktop(row){
    if(connection.mode!=='desktop')return false;
    await api('/api/sync/cloud-lead',{method:'POST',body:JSON.stringify({lead:row})});return true;
  }
  function ms(value){const n=Date.parse(value||'');return Number.isFinite(n)?n:0;}
  async function promoteAllFinderLeadsToCrm(){
    if(connection.mode!=='desktop'||!cloud.signedIn)return {promoted:0,linked:0,skipped:0};
    const pending=Array.isArray(state.contactIntent)?state.contactIntent.filter(x=>x&&x.googlePlaceId):[];
    if(!pending.length)return {promoted:0,linked:0,skipped:0};
    const result=await api('/api/contact-intent/promote-all',{method:'POST',body:'{}'});
    await refreshDesktopData({quiet:true});
    return result||{promoted:0,linked:0,skipped:0};
  }
  async function fullCloudSync({quiet=false}={}){
    if(cloudSync.running||!cloud.configured)return false;
    cloudSync.running=true;cloudSync.error='';cloudSync.uploaded=0;cloudSync.downloaded=0;cloudSync.updatedCloud=0;cloudSync.updatedDesktop=0;if(!quiet)render();
    try{
      const client=await ensureSupabaseClient();const {data:sessionData,error:sessionError}=await client.auth.getSession();if(sessionError)throw sessionError;
      cloud.signedIn=Boolean(sessionData?.session);cloud.userEmail=sessionData?.session?.user?.email||'';if(!cloud.signedIn){cloudSync.status='Sign in with GitHub to sync';return false;}
      let cloudRows=await fetchCloudLeads(client);
      if(connection.mode==='desktop'){
        const promotion=await promoteAllFinderLeadsToCrm();
        await refreshDesktopData({quiet:true});
        let localRows=[...state.leads];const cloudById=new Map(cloudRows.map(r=>[r.id,r]));const localById=new Map(localRows.map(r=>[r.id,r]));
        if(promotion&&(promotion.promoted||promotion.linked))cloudSync.status=`Added ${Number(promotion.promoted||0)+Number(promotion.linked||0)} Finder lead${Number(promotion.promoted||0)+Number(promotion.linked||0)===1?'':'s'} to the synced CRM`;
        for(const local of localRows){
          const remote=cloudById.get(local.id);
          if(!remote){await upsertLeadToCloud(local);cloudSync.uploaded++;continue;}
          const lt=ms(local.updatedAt),ct=ms(remote.updated_at);
          if(lt>ct+1500){await upsertLeadToCloud(local,remote);cloudSync.updatedCloud++;}
          else if(ct>lt+1500){await mirrorCloudLeadToDesktop(remote);cloudSync.updatedDesktop++;}
        }
        for(const remote of cloudRows){if(!localById.has(remote.id)){await mirrorCloudLeadToDesktop(remote);cloudSync.downloaded++;}}
        await refreshDesktopData({quiet:true});cloudRows=await fetchCloudLeads(client);
      }else{
        state.leads=cloudRows.map(mapCloudLead);state.events=[];save();
      }
      if(connection.mode==='desktop')Object.assign(syncPreview,buildSyncPreview(state.leads,cloudRows));else Object.assign(syncPreview,buildSyncPreview(state.leads,cloudRows));
      cloud.leadCount=cloudRows.length;cloud.leadNames=cloudRows.slice(0,10).map(x=>x.business_name).filter(Boolean);cloud.status=`Connected · ${cloudRows.length} cloud lead${cloudRows.length===1?'':'s'} synced`;
      cloudSync.lastAt=new Date().toISOString();cloudSync.status=`Synced · ${cloudSync.uploaded} uploaded · ${cloudSync.downloaded} downloaded · ${cloudSync.updatedCloud} cloud updates · ${cloudSync.updatedDesktop} Desktop updates`;
      return true;
    }catch(error){cloudSync.error=error.message||'Cloud sync failed.';cloudSync.status='Sync failed';return false;}
    finally{cloudSync.running=false;if(!quiet)render();}
  }
  function scheduleCloudSync(){
    if(cloudSync.timer)clearInterval(cloudSync.timer);
    cloudSync.timer=setInterval(()=>{if(cloud.signedIn&&!document.hidden)fullCloudSync({quiet:true}).then(()=>render());},15000);
  }
  function normalizePhone(value){
    let raw=String(value||'').trim().replace(/[()\s.-]/g,'');
    if(!raw)return '';
    if(raw.startsWith('+'))return raw;
    const cc=String(voice.countryCode||'+61').replace(/\s/g,'');
    if(raw.startsWith('00'))return '+'+raw.slice(2);
    if(cc==='+61'&&raw.startsWith('0'))return '+61'+raw.slice(1);
    return cc+raw.replace(/^0+/,'');
  }
  async function ensureTwilioSdk(){
    if(window.Twilio&&window.Twilio.Device)return window.Twilio;
    if(voice.sdkPromise)return voice.sdkPromise;
    voice.sdkPromise=new Promise((resolve,reject)=>{
      const urls=[
        'https://cdn.jsdelivr.net/npm/@twilio/voice-sdk@2.18.5/dist/twilio.min.js',
        'https://unpkg.com/@twilio/voice-sdk@2.18.5/dist/twilio.min.js'
      ];
      let i=0; const tryNext=()=>{
        if(i>=urls.length)return reject(new Error('Could not load the Twilio Voice SDK. Check your internet connection.'));
        const script=document.createElement('script'); script.src=urls[i++]; script.async=true;
        script.onload=()=>window.Twilio&&window.Twilio.Device?resolve(window.Twilio):(script.remove(),tryNext());
        script.onerror=()=>{script.remove();tryNext();}; document.head.appendChild(script);
      }; tryNext();
    });
    return voice.sdkPromise;
  }
  async function refreshVoiceToken(){
    const tokenData=await api('/api/twilio-token');
    voice.tokenExpiresAt=Date.now()+Number(tokenData.expiresIn||3600)*1000;
    voice.callerId=tokenData.callerId||voice.callerId; voice.identity=tokenData.identity||voice.identity; voice.countryCode=tokenData.countryCode||voice.countryCode; voice.edge=tokenData.edge||voice.edge||'roaming';
    if(voice.device)voice.device.updateToken(tokenData.token);
    return tokenData.token;
  }
  async function ensureVoiceDevice(){
    if(!connection.twilio)throw new Error('Twilio Browser Calling is not configured yet. Open Settings → Twilio Browser Calling.');
    const TwilioSdk=await ensureTwilioSdk();
    if(voice.device)return voice.device;
    voice.state='starting'; voice.error=''; if(activeLeadId)renderDrawer();
    const token=await refreshVoiceToken();
    const deviceOptions={closeProtection:true,allowIncomingWhileBusy:false,maxCallSignalingTimeoutMs:30000};
    if(voice.edge&&voice.edge!=='roaming')deviceOptions.edge=voice.edge;
    voice.device=new TwilioSdk.Device(token,deviceOptions);
    voice.device.on('error',err=>{voice.error=err?.message||'Twilio device error.';voice.state='error';if(activeLeadId)renderDrawer();});
    voice.device.on('tokenWillExpire',async()=>{try{await refreshVoiceToken();}catch(error){voice.error=error.message||'Could not refresh Twilio token.';}});
    voice.state='ready';
    return voice.device;
  }
  function bindVoiceCall(call){
    voice.call=call; voice.state='dialling'; voice.error=''; voice.muted=false; voice.keypad=false; voice.connectedAt=null; voice.lastCallSid='';
    call.on('ringing',()=>{voice.state='ringing';if(activeLeadId)renderDrawer();});
    call.on('accept',()=>{voice.state='connected';voice.connectedAt=Date.now();callStart=voice.connectedAt;clearInterval(callTimer);callTimer=setInterval(updateTimer,1000);voice.lastCallSid=call.parameters?.CallSid||voice.lastCallSid;if(activeLeadId)renderDrawer();});
    call.on('mute',(muted)=>{voice.muted=Boolean(muted);if(activeLeadId)renderDrawer();});
    call.on('error',err=>{voice.error=err?.message||'Call error.';voice.state='error';if(activeLeadId)renderDrawer();});
    const ended=()=>{voice.lastCallSid=call.parameters?.CallSid||voice.lastCallSid;voice.call=null;voice.state='ended';clearInterval(callTimer);callTimer=null;if(activeLeadId)renderDrawer();};
    call.on('disconnect',ended);call.on('cancel',ended);call.on('reject',ended);
  }
  async function placeBrowserCall(lead){
    const device=await ensureVoiceDevice();
    const to=normalizePhone(lead.phone); if(!to)throw new Error('This lead does not have a callable phone number.');
    try{
      const call=await device.connect({params:{To:to},rtcConstraints:{audio:true}}); bindVoiceCall(call);
    }catch(error){voice.state='error';voice.error=error.message||'Could not start the call.';throw error;}
  }
  function hangupVoiceCall(){if(voice.call){try{voice.call.disconnect();}catch{}}else if(voice.device){try{voice.device.disconnectAll();}catch{}}voice.state='ended';clearInterval(callTimer);callTimer=null;if(activeLeadId)renderDrawer();}
  function toggleVoiceMute(){if(!voice.call)return;voice.call.mute(!voice.call.isMuted());voice.muted=voice.call.isMuted();if(activeLeadId)renderDrawer();}
  function sendVoiceDigit(digit){if(voice.call&&/^[0-9*#]$/.test(digit)){try{voice.call.sendDigits(digit);}catch{}}}
  async function patchLead(id, patch){
    if(connection.mode==='desktop'){
      await api(`/api/leads/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(patch)});await refreshDesktopData({quiet:true});
      if(cloud.signedIn){const lead=leadById(id);if(lead)await upsertLeadToCloud(lead);}
    }else if(cloud.signedIn){
      const row=await patchCloudLead(id,patch);const mapped=mapCloudLead(row),i=state.leads.findIndex(x=>x.id===id);if(i>=0)state.leads[i]=mapped;else state.leads.unshift(mapped);save();
    }else{Object.assign(leadById(id),patch);save();}
    render();if(activeLeadId)renderDrawer();
  }
  async function refreshOutreachMessageSettings(){
    if(connection.mode==='desktop'){
      try{
        const result=await api('/api/outreach-message-settings');
        outreachMessageSettings={website:String(result.website||''),email:String(result.email||'hello@firstseendigital.com.au')};
        return true;
      }catch{}
    }
    outreachMessageSettings={website:String(state.settings.outreachWebsite||''),email:String(state.settings.outreachEmail||'hello@firstseendigital.com.au')};
    return false;
  }
  async function saveOutreachMessageSettings(website,email){
    const next={website:String(website||'').trim(),email:String(email||'').trim()||'hello@firstseendigital.com.au'};
    if(connection.mode==='desktop') await api('/api/outreach-message-settings',{method:'POST',body:JSON.stringify(next)});
    else {state.settings.outreachWebsite=next.website;state.settings.outreachEmail=next.email;save();}
    outreachMessageSettings=next;
    return next;
  }
  function outreachMessage(l){
    const website=String(outreachMessageSettings.website||'').trim();
    const email=String(outreachMessageSettings.email||'').trim();
    return [
      `Hey, is this ${l.business}? Harvey here from FirstSeen Digital.`,
      `I found your business online and noticed ${callSpecificReason(l)}.`,
      'I build websites for local businesses, and I think I could help.',
      website?`If you'd like to see what I do, check out my website: ${website}`:"If you'd like to see what I do, check out the FirstSeen Digital website.",
      email?`You can also reach me at ${email}.`:'',
      'No pressure either way.',
      'Harvey — FirstSeen Digital',
      "Reply STOP if you don't want any further messages."
    ].filter(Boolean).join('\n\n');
  }
  function smsHref(phone,body){
    const number=normalizePhone(phone)||String(phone||'').replace(/\s/g,'');
    const separator=/iPhone|iPad|iPod/i.test(navigator.userAgent)?'&':'?';
    return `sms:${number}${separator}body=${encodeURIComponent(body)}`;
  }
  function messageButton(l,label='Message'){
    return l&&l.phone?`<button class="message-btn" data-message="${esc(l.id)}">${esc(label)}</button>`:'';
  }
  function allLeads(){return [...state.leads,...state.contactIntent]}
  function leadById(id){return allLeads().find(l=>l.id===id)}
  function allCallableLeads(){return allLeads().filter(l=>l.phone)}
  function statusStyle(status){const [bg,fg]=STATUS_COLORS[status]||['#eee','#333'];return `background:${bg};color:${fg}`}
  function todayHours(l){
    const descriptions=Array.isArray(l?.openingHours?.weekdayDescriptions)?l.openingHours.weekdayDescriptions:[];
    if(!descriptions.length)return '';
    const weekday=new Intl.DateTimeFormat('en-AU',{weekday:'long'}).format(new Date()).toLowerCase();
    return descriptions.find(line=>String(line).toLowerCase().startsWith(weekday))||descriptions[0]||'';
  }
  function openStatusLabel(l){
    if(l?.businessStatus&&l.businessStatus!=='OPERATIONAL')return String(l.businessStatus).replaceAll('_',' ');
    if(l?.openNow===true)return 'Open now';
    if(l?.openNow===false)return 'Closed now';
    return 'Hours unknown';
  }
  function autoBusinessSummary(l={}){
    const business=String(l.business||l.name||'This business').trim(),raw=String(l.category||l.industry||'').replace(/_/g,' ').replace(/\s+/g,' ').trim(),area=String(l.suburb||l.area||l.address||'').trim(),hay=`${business} ${raw}`.toLowerCase();
    let type=raw||'local service',work=raw?`services related to ${raw.toLowerCase()}`:'local services for customers in its area';
    const rules=[[/auto body|bodywork|panel beat|collision/,'auto body repair','vehicle body repairs, panel work, accident repairs and cosmetic restoration'],[/mobile mechanic/,'mobile mechanic','mobile vehicle servicing, repairs, maintenance and mechanical diagnostics'],[/mechanic|auto repair|automotive|lube|car service|vehicle repair/,'mechanic','vehicle servicing, repairs, preventative maintenance and mechanical diagnostics'],[/electric/,'electrical','electrical installation, repairs, maintenance, upgrades and fault-finding'],[/plumb/,'plumbing','plumbing repairs, maintenance, installations and general plumbing work'],[/air condition|hvac|refrigerat/,'air-conditioning','air-conditioning installation, servicing, repairs and maintenance'],[/carpenter|carpentry/,'carpentry','carpentry, timber work, repairs, fit-outs and installation'],[/builder|construction|building contractor/,'building','building, renovation, repair and construction work'],[/roof/,'roofing','roof repairs, maintenance, replacement and related roofing work'],[/paint/,'painting','residential or commercial painting, preparation and surface finishing'],[/landscap|garden/,'landscaping','landscaping, garden maintenance and outdoor improvement work'],[/clean/,'cleaning','cleaning and property maintenance services'],[/pest/,'pest control','pest inspection, treatment and prevention services'],[/locksmith/,'locksmith','lock, key, security and property access services'],[/solar/,'solar','solar installation, servicing and energy-related work'],[/concret/,'concreting','concreting, slabs, paths, driveways and related site work'],[/tyre|tire/,'tyre','tyre fitting, replacement, balancing and related vehicle services'],[/tow/,'towing','vehicle towing, transport and roadside assistance']];
    for(const [rx,label,desc] of rules)if(rx.test(hay)){type=label;work=desc;break;}
    const article=/^[aeiou]/i.test(type)?'an':'a',parts=[`${business} is ${article} ${type} business${area?` serving ${area}`:''}.`,`It appears to focus on ${work}.`];
    if(l.serviceAreaBusiness)parts.push('It operates as a service-area business, so customers may be served across multiple suburbs rather than from a single storefront.');
    if(!l.website)parts.push('No dedicated website is currently listed in FirstSeen, so its online presence appears to rely more heavily on business listings and other channels.');
    else if(String(l.websiteQuality||'').toLowerCase().includes('poor'))parts.push('A dedicated website is listed, and FirstSeen has identified opportunities to improve how clearly it presents the business and converts visitors into enquiries.');
    else parts.push('A dedicated website is listed as part of its current online presence.');
    return parts.join(' ');
  }
  function reviewSnapshot(l={}){const rating=Number(l.rating||0),reviews=Number(l.reviews||0);if(!(rating>0)||!(reviews>0))return '';return `Google Maps review snapshot: ${rating.toFixed(1)}★ from ${reviews.toLocaleString('en-AU')} review${reviews===1?'':'s'}.`;}
  function reviewSnapshotHtml(l={}){const text=reviewSnapshot(l);if(!text)return '';return `<div class="summary-review-snapshot"><strong>Review snapshot</strong><span>${esc(text)}</span>${l.googleMapsUrl?`<a href="${esc(l.googleMapsUrl)}" target="_blank" rel="noopener">View on Google Maps</a>`:''}</div>`;}
  function leadReason(l){
    const reputation=l.rating?`${l.rating}★ from ${l.reviews||0} Google reviews`:'an established local presence';
    if(!l.website) return `${l.business} has ${reputation}, but no website is listed. That gives you a specific reason to call: they already have trust and visibility, but customers have no dedicated site to land on.`;
    if((l.websiteQuality||'').toLowerCase().includes('poor')) {
      const issue=(l.auditReasons||[])[0];
      return `${l.business} already has a website, but FirstSeen found room to improve${issue?` (${issue})`:''}. Lead with making it easier for local customers to understand the offer and get in touch, rather than criticising the existing site.`;
    }
    return `${l.business} has ${reputation}. Use the call to learn how customers currently find them, whether the site produces enquiries, and whether they want more of a particular type of work.`;
  }
  function callSpecificReason(l){
if(!l.website)return 'you don’t appear to have a dedicated website listed';
const auditReason=(l.auditReasons||[]).find(Boolean);
if(auditReason){
  const reason=String(auditReason).trim().replace(/[.!?]+$/,'');
  return reason?reason.charAt(0).toLowerCase()+reason.slice(1):'there may be an opportunity to improve how customers find and contact you online';
}
if((l.websiteQuality||'').toLowerCase().includes('poor'))return 'your website looks like it could make it easier for customers to understand what you do and get in touch';
if(l.rating&&Number(l.reviews||0)>=20)return `you’ve built a strong Google reputation with ${l.reviews} reviews, and I wanted to see how well your website is turning that visibility into enquiries`;
return 'I wanted to see how well your online presence is turning local searches into enquiries';
}
function callWebsiteIssue(l){
const auditReason=(l.auditReasons||[]).find(Boolean);
if(auditReason)return String(auditReason).trim().replace(/[.!?]+$/,'');
if((l.websiteQuality||'').toLowerCase().includes('poor'))return 'the site could make it easier for customers to understand what you do and get in touch';
return 'there may be a few areas where the site could turn more local searches into enquiries';
}
function callScript(l){
return `Hey, is this ${l.business}? Harvey here from FirstSeen. I found your business online and noticed ${callSpecificReason(l)}. I build websites for local businesses, and I think I could help. I’m just looking to grab 10 minutes with you sometime this week and show you what I mean. Would you be open to that?`;
}
function callScriptLines(l){
return [
`Hey, is this ${l.business}?`,
'Harvey here from FirstSeen.',
`I found your business online and noticed ${callSpecificReason(l)}.`,
'I build websites for local businesses, and I think I could help.',
'I’m just looking to grab 10 minutes with you sometime this week and show you what I mean.',
'Would you be open to that?'
].join('\n');
}
  function audit(l){
    const items=[];
    if(!l.website){items.push(['bad','No website listed','Customers searching the business have no owned website destination.']);}
    else if((l.websiteQuality||'').toLowerCase().includes('poor')) items.push(['bad','Website marked poor','Good opening for a redesign conversation.']);
    else items.push(['good','Website exists','Confirm whether it is producing calls and enquiries.']);
    if((l.reviews||0)>=20) items.push(['good','Strong review proof',`${l.reviews} reviews can be reused as trust signals on a site.`]);
    if(l.phone) items.push(['good','Direct phone available','Ready for click-to-call and browser calling.']);
    if(!l.email) items.push(['bad','No email saved','Ask for the best email if they request information.']);
    return items;
  }
  function priority(l){
    let p=Number(l.score||0);
    if(l.nextFollowUp){const diff=new Date(l.nextFollowUp)-new Date(); if(diff<=0)p+=30; else if(diff<86400000)p+=20;}
    if(l.status==='Follow Up')p+=15;if(l.status==='Spoke To')p+=8;if(l.status==='Quote Sent')p+=5;if(l.status==='Uncontacted')p+=10;
    if(['Won','Lost','Meeting Booked'].includes(l.status))p-=60;
    return p;
  }
  function callAttempts(l){return (l.activities||[]).filter(a=>a.type==='call').length;}
  function lastCallActivity(l){return [...(l.activities||[])].filter(a=>a.type==='call').sort((a,b)=>new Date(b.at)-new Date(a.at))[0]||null;}
  function answerLikelihood(l){
    if(!l.phone||['Won','Lost','Meeting Booked'].includes(l.status))return 0;
    let p=50; const now=new Date(), h=now.getHours()+now.getMinutes()/60, day=now.getDay();
    if(day===0)p-=30; else if(day===6)p-=15;
    if(h>=8&&h<9.5)p+=16; else if(h>=11&&h<13.5)p+=12; else if(h>=15&&h<17.5)p+=14; else if(h>=9.5&&h<11)p+=7; else if(h>=13.5&&h<15)p+=5; else p-=20;
    const cat=(l.category||'').toLowerCase();
    if(cat.includes('mobile')||cat.includes('trade')){if((h>=7.5&&h<9)||(h>=16&&h<18))p+=6;}
    if(cat.includes('mechanic')||cat.includes('panel')){if((h>=8&&h<9.5)||(h>=12&&h<13.5)||(h>=15&&h<16.5))p+=5;}
    if((l.phone||'').replace(/\s/g,'').startsWith('04'))p+=3;
    if(l.businessStatus&&l.businessStatus!=='OPERATIONAL')p-=45;
    if(l.openNow===true)p+=12; else if(l.openNow===false)p-=28;
    if(l.status==='Follow Up')p+=12; else if(l.status==='Spoke To')p+=10; else if(l.status==='Quote Sent')p+=7; else if(l.status==='Uncontacted')p+=3; else if(l.status==='Attempted')p-=4;
    if(l.nextFollowUp){const diff=new Date(l.nextFollowUp)-now;if(diff<=0)p+=10;else if(diff<7200000)p+=12;else if(diff<86400000)p+=6;}
    const last=lastCallActivity(l);
    if(last){const age=now-new Date(last.at);if(age<7200000)p-=35;else if(age<86400000)p-=14;else if(age<172800000)p-=5;if((last.text||'').toLowerCase().includes('no answer'))p-=5;}
    p-=Math.max(0,callAttempts(l)-1)*3;
    return Math.max(5,Math.min(95,Math.round(p)));
  }
  function bestCallWindow(l){
    const hours=todayHours(l);
    const cat=(l.category||'').toLowerCase();
    const suggested=(cat.includes('mobile')||cat.includes('trade'))
      ? '7:30–9:00 or 4:00–5:30'
      : (cat.includes('mechanic')||cat.includes('panel'))
        ? '8:00–9:30 or 3:00–4:30'
        : '8:00–9:30, 11:30–1:00 or 3:30–5:00';
    return hours?`${suggested} · ${hours}`:suggested;
  }

  const navItems = [
    ['dashboard','Dashboard',false],['leads','Leads',false],['wantcontact','Want to Contact',true],['callqueue','Call Queue',false],['pipeline','Pipeline',false],['today','Today',false],['analytics','Analytics',false]
  ];
  function wantContactCrmLeads(){return state.leads.filter(l=>l.status==='Uncontacted');}
  function wantContactFinderLeads(){
    const full=state.leads;
    return state.contactIntent.filter(x=>!full.some(l=>(x.googlePlaceId&&l.googlePlaceId&&x.googlePlaceId===l.googlePlaceId)||(syncDigits(x.phone)&&syncDigits(x.phone)===syncDigits(l.phone))||(syncNorm(x.business)&&syncNorm(x.business)===syncNorm(l.business)&&syncNorm(x.suburb)===syncNorm(l.suburb))));
  }
  function renderNav(){
    const wantCount=wantContactCrmLeads().length;
    el('nav').innerHTML=navItems.map(([id,label,nested])=>`<button data-nav="${id}" class="${activeView===id?'active':''} ${nested?'nav-child':''}"><span>${nested?'<span class="nav-branch">↳</span>':''}${label}</span>${id==='callqueue'?`<span class="count">${getQueue().length}</span>`:id==='wantcontact'?`<span class="count">${wantCount}</span>`:''}</button>`).join('');
    document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>{activeView=b.dataset.nav; render();});
  }
  function render(){
    renderNav();
    const titles={dashboard:['Performance','Dashboard'],leads:['CRM board','Leads'],wantcontact:['Leads','Want to Contact'],callqueue:['Sales mode','Call Queue'],pipeline:['Opportunity stages','Pipeline'],today:['Daily focus','Today'],analytics:['Sales intelligence','Analytics'],settings:['Workspace','Settings']};
    const [eye,title]=titles[activeView]||titles.leads;el('pageEyebrow').textContent=eye;el('pageTitle').textContent=title;
    el('searchInput').style.display=['leads','wantcontact','pipeline','callqueue'].includes(activeView)?'block':'none';
    el('startCallingBtn').style.display=activeView==='settings'?'none':'inline-block';el('addLeadBtn').style.display=activeView==='settings'?'none':'inline-block';
    const w=el('workspace');
    if(activeView==='dashboard')w.innerHTML=renderDashboard();
    if(activeView==='leads')w.innerHTML=renderLeads();
    if(activeView==='wantcontact')w.innerHTML=renderWantContact();
    if(activeView==='callqueue')w.innerHTML=renderCallQueue();
    if(activeView==='pipeline')w.innerHTML=renderPipeline();
    if(activeView==='today')w.innerHTML=renderToday();
    if(activeView==='analytics')w.innerHTML=renderAnalytics();
    if(activeView==='settings')w.innerHTML=renderSettings();
    bindViewEvents();
  }
  function getSearch(){return el('searchInput').value.trim().toLowerCase()}
  function mostLikelyToAnswer(){
    return state.leads
      .filter(l=>isOpen(l)&&l.phone&&!['Meeting Booked'].includes(l.status))
      .sort((a,b)=>answerLikelihood(b)-answerLikelihood(a)||priority(b)-priority(a));
  }
  function filteredLeads(){
    const q=getSearch(); let list=[...state.leads];
    if(boardFilter==='Open') list=list.filter(isOpen);
    else if(boardFilter==='Most Likely to Answer') list=mostLikelyToAnswer();
    else if(boardFilter!=='All') list=list.filter(l=>l.status===boardFilter);
    if(q)list=list.filter(l=>[l.business,l.phone,l.email,l.website,l.suburb,l.category,l.source,l.notes,l.status].join(' ').toLowerCase().includes(q));
    return list;
  }
  function metrics(){
    const calls=state.events.filter(e=>e.type==='call').length + state.leads.reduce((n,l)=>n+(l.activities||[]).filter(a=>a.type==='call').length,0);
    const conversations=state.leads.filter(l=>['Spoke To','Follow Up','Meeting Booked','Quote Sent','Won'].includes(l.status)).length;
    const meetings=state.leads.filter(l=>['Meeting Booked','Quote Sent','Won'].includes(l.status)).length;
    const wins=state.leads.filter(l=>l.status==='Won');
    return {calls,conversations,meetings,wins:wins.length,revenue:wins.reduce((n,l)=>n+Number(l.value||0),0),open:state.leads.filter(isOpen).length};
  }
  function statsHtml(){const m=metrics();return `<div class="stats"><div class="stat"><div class="k">Open leads</div><div class="v">${m.open}</div><div class="s">Need a next action</div></div><div class="stat"><div class="k">Calls logged</div><div class="v">${m.calls}</div><div class="s">Activity history</div></div><div class="stat"><div class="k">Conversations</div><div class="v">${m.conversations}</div><div class="s">Reached decision maker</div></div><div class="stat"><div class="k">Meetings+</div><div class="v">${m.meetings}</div><div class="s">Booked or progressed</div></div><div class="stat"><div class="k">Won value</div><div class="v">${money(m.revenue)}</div><div class="s">Closed work</div></div></div>`}
  function renderDashboard(){
    const queue=getQueue().slice(0,5),due=getDue().slice(0,5);return `${statsHtml()}<div class="today-grid"><div class="panel"><h3>Best leads to call next</h3>${queue.map((l,i)=>`<div class="task" data-open="${l.id}"><div><strong>${i+1}. ${esc(l.business)}</strong><div class="muted">${esc(l.suburb)} · ${esc(l.category)} · Score ${l.score}</div></div><button class="call-btn" data-call="${l.id}">Call</button>${messageButton(l)}</div>`).join('')||'<div class="empty">Queue clear.</div>'}</div><div class="panel"><h3>Follow-ups due</h3>${due.map(l=>`<div class="task" data-open="${l.id}"><div><strong>${esc(l.business)}</strong><div class="muted">${esc(l.status)}</div></div><div class="${new Date(l.nextFollowUp)<new Date()?'overdue':'due'}">${fmtDate(l.nextFollowUp)}</div></div>`).join('')||'<div class="empty">Nothing due.</div>'}</div></div>`
  }
  function renderLeads(){
    const leads=filteredLeads();
    const chips=['Open','Most Likely to Answer','All','Uncontacted','Follow Up','Quote Sent'];
    if(boardFilter==='Most Likely to Answer'){
      return `${statsHtml()}<div class="toolbar"><div class="toolbar-left">${chips.map(v=>`<button class="chip ${boardFilter===v?'active':''}" data-filter="${v}">${v}</button>`).join('')}</div><div class="toolbar-right"><span class="muted">${leads.length} callable leads · most likely to pick up first</span></div></div><div class="panel" style="margin-bottom:12px"><strong>Most Likely to Answer</strong><div class="muted" style="margin-top:4px">Estimates who is most likely to pick up if you call now, using time of day, business type, previous call attempts, follow-up timing and whether you have spoken before. It is a guide, not a guarantee.</div></div><div class="board">${renderAnswerLikelihoodGroup(leads)}</div>`;
    }
    const groups=STATUS.filter(s=>leads.some(l=>l.status===s));
    return `${statsHtml()}<div class="toolbar"><div class="toolbar-left">${chips.map(v=>`<button class="chip ${boardFilter===v?'active':''}" data-filter="${v}">${v}</button>`).join('')}</div><div class="toolbar-right"><span class="muted">${leads.length} leads</span></div></div><div class="board">${groups.map(s=>renderGroup(s,leads.filter(l=>l.status===s))).join('')||'<div class="empty">No leads match this view.</div>'}</div>`
  }
  function renderAnswerLikelihoodGroup(list){
    return `<section class="group"><div class="group-head"><div class="group-title"><span class="dot" style="background:#1fa36b"></span>Most Likely to Answer<span class="group-count">${list.length}</span></div><div class="group-count">Best answer chance right now</div></div><div class="table-wrap"><table class="lead-table"><thead><tr><th>Rank</th><th>Business</th><th>Call</th><th>Answer likelihood</th><th>Best call window</th><th>Last attempt</th><th>Status</th><th>Area</th><th>Next follow-up</th><th>Lead score</th></tr></thead><tbody>${list.map((l,i)=>{const chance=answerLikelihood(l),last=lastCallActivity(l);return `<tr class="lead-row" data-open="${l.id}"><td><strong>#${i+1}</strong></td><td><div class="biz">${esc(l.business)}</div><div class="muted">${esc(l.phone)}</div></td><td><div class="contact-buttons"><button class="call-btn" data-call="${l.id}">Call</button>${messageButton(l)}</div></td><td><span class="score ${chance>=75?'high':chance>=55?'mid':'low'}">${chance}%</span></td><td>${esc(bestCallWindow(l))}</td><td>${last?fmtDate(last.at):'Never'}</td><td><span class="status-pill" style="${statusStyle(l.status)}">${esc(l.status)}</span></td><td>${esc(l.suburb)}</td><td>${fmtDate(l.nextFollowUp)}</td><td><span class="score ${l.score>=85?'high':l.score>=70?'mid':'low'}">${l.score}</span></td></tr>`}).join('')||'<tr><td colspan="10"><div class="empty">No callable leads.</div></td></tr>'}</tbody></table></div></section>`
  }
  function renderGroup(status,list){return `<section class="group"><div class="group-head"><div class="group-title"><span class="dot" style="background:${STATUS_COLORS[status]?.[1]||'#667'}"></span>${status}<span class="group-count">${list.length}</span></div><div class="group-count">${money(list.reduce((n,l)=>n+Number(l.value||0),0))} potential</div></div><div class="table-wrap"><table class="lead-table"><thead><tr><th>Business</th><th>Call</th><th>Lead score</th><th>Website</th><th>Status</th><th>Area</th><th>Reviews</th><th>Next follow-up</th><th>Value</th><th>Source</th></tr></thead><tbody>${list.map(l=>`<tr class="lead-row" data-open="${l.id}"><td><div class="biz">${esc(l.business)}</div><div class="muted">${esc(l.phone)}</div></td><td><div class="contact-buttons"><button class="call-btn" data-call="${l.id}">Call</button>${messageButton(l)}</div></td><td><span class="score ${l.score>=85?'high':l.score>=70?'mid':'low'}">${l.score}</span></td><td><span class="${!l.website?'website-bad':(l.websiteQuality||'').toLowerCase().includes('poor')?'website-ok':'website-good'}">${esc(l.websiteQuality|| (l.website?'Website':'No website'))}</span></td><td><span class="status-pill" style="${statusStyle(l.status)}">${esc(l.status)}</span></td><td>${esc(l.suburb)}</td><td>${l.rating?`${l.rating}★ · ${l.reviews}`:'—'}</td><td>${fmtDate(l.nextFollowUp)}</td><td>${money(l.value)}</td><td>${esc(l.source)}</td></tr>`).join('')}</tbody></table></div></section>`}
  function getQueue(){return state.leads.filter(l=>isOpen(l)&&l.phone&&!['Meeting Booked'].includes(l.status)).sort((a,b)=>priority(b)-priority(a));}
  function renderWantContact(){
    const q=getSearch();
    let crm=wantContactCrmLeads();
    if(q)crm=crm.filter(l=>[l.business,l.phone,l.email,l.website,l.suburb,l.category,l.source,l.businessSummary,l.notes].join(' ').toLowerCase().includes(q));
    crm.sort((a,b)=>answerLikelihood(b)-answerLikelihood(a)||Number(b.score||0)-Number(a.score||0));
    const rows=crm.map(l=>`<tr class="lead-row" data-open="${l.id}"><td><div class="biz">${esc(l.business)}</div><div class="muted">${esc(l.category)}</div></td><td>${l.phone?`<div class="contact-buttons"><button class="call-btn" data-call="${l.id}">Call</button>${messageButton(l)}</div>`:'—'}</td><td><span class="score ${answerLikelihood(l)>=75?'high':answerLikelihood(l)>=55?'mid':'low'}">${answerLikelihood(l)}%</span></td><td>${esc(openStatusLabel(l))}</td><td>${esc(l.phone)||'—'}</td><td><span class="${!l.website?'website-bad':'website-good'}">${esc(l.websiteQuality||(l.website?'Website':'No website'))}</span></td><td>${l.rating?`${l.rating}★ · ${l.reviews}`:'—'}</td><td>${esc(l.suburb)}</td><td>${fmtDate(l.createdAt)}</td><td><span class="status-pill" style="background:#e6f7ef;color:#168a5b">Want to contact</span></td></tr>`).join('');
    const tableHead='<thead><tr><th>Business</th><th>Contact</th><th>Answer likelihood</th><th>Open now</th><th>Phone</th><th>Website</th><th>Reviews</th><th>Area</th><th>Added</th><th>Status</th></tr></thead>';
    return `<div class="panel" style="margin-bottom:12px"><strong>Want to Contact</strong><div class="muted" style="margin-top:4px">Every lead here is now a full Supabase-synced CRM lead. Finder businesses you mark 👍 Lead are automatically promoted into the CRM, so the same business, notes, calls, messages, status and follow-ups are available on Desktop and phone.</div></div><div class="board"><section class="group"><div class="group-head"><div class="group-title"><span class="dot" style="background:#1fa36b"></span>Leads to contact<span class="group-count">${crm.length}</span></div><div class="group-count">Synced with Supabase</div></div><div class="table-wrap"><table class="lead-table">${tableHead}<tbody>${rows||'<tr><td colspan="10"><div class="empty">No uncontacted CRM leads right now.</div></td></tr>'}</tbody></table></div></section></div>`;
  }
  function renderCallQueue(){
    const q=getQueue(),active=leadById(callLeadId)||q[0]; if(!active)return '<div class="empty">No callable leads.</div>';
    return `<div class="queue-shell"><div class="queue-list">${q.map((l,i)=>`<div class="queue-row ${active.id===l.id?'active':''}" data-queue="${l.id}"><div class="rank">${i+1}</div><div><strong>${esc(l.business)}</strong><div class="muted">${esc(l.suburb)} · ${esc(l.category)} · ${esc(l.status)}</div></div><div class="score ${l.score>=85?'high':'mid'}">${l.score}</div></div>`).join('')}</div><div class="focus-card"><div class="eyebrow">Next best call</div><h2>${esc(active.business)}</h2><div class="muted">${esc(active.phone)} · ${esc(active.suburb)}</div><div class="reason"><strong>Why this lead</strong><br>${esc(leadReason(active))}</div><div class="script">${esc(callScript(active))}</div><div class="focus-actions"><button class="primary-btn" data-call="${active.id}">Call ${esc(active.business)}</button>${messageButton(active)}<button class="secondary-btn" data-open="${active.id}">Open lead</button><button class="secondary-btn" data-skip="${active.id}">Skip for now</button></div></div></div>`
  }
  function renderPipeline(){
    const q=getSearch();const list=q?state.leads.filter(l=>[l.business,l.suburb,l.category,l.status].join(' ').toLowerCase().includes(q)):state.leads;
    return `<div class="pipeline">${STATUS.filter(s=>!['Lost'].includes(s)).map(s=>`<div class="pipeline-col"><div class="pipeline-head"><span>${s}</span><span>${list.filter(l=>l.status===s).length}</span></div>${list.filter(l=>l.status===s).map(l=>`<div class="lead-card" draggable="true" data-drag="${l.id}" data-open="${l.id}"><div class="title">${esc(l.business)}</div><div class="meta">${esc(l.suburb)} · ${esc(l.category)}</div><div class="card-foot"><span class="score ${l.score>=85?'high':'mid'}">${l.score}</span><div style="display:flex;gap:6px;align-items:center"><span class="tiny">${money(l.value)}</span>${l.phone?`<button class="call-btn compact-call" data-call="${l.id}">Call</button>${messageButton(l)}`:''}</div></div></div>`).join('')}<div class="pipeline-drop" data-drop="${s}" style="height:20px"></div></div>`).join('')}</div>`
  }
  function getDue(){return state.leads.filter(l=>l.nextFollowUp&&isOpen(l)).sort((a,b)=>new Date(a.nextFollowUp)-new Date(b.nextFollowUp));}
  function renderToday(){
    const due=getDue(),today=due.filter(l=>new Date(l.nextFollowUp).toDateString()===new Date().toDateString()),over=due.filter(l=>new Date(l.nextFollowUp)<new Date()&&new Date(l.nextFollowUp).toDateString()!==new Date().toDateString());
    return `${statsHtml()}<div class="today-grid"><div class="panel"><h3>Today</h3>${today.map(l=>taskRow(l)).join('')||'<div class="empty">No follow-ups scheduled today.</div>'}</div><div class="panel"><h3>Overdue</h3>${over.map(l=>taskRow(l,true)).join('')||'<div class="empty">Nothing overdue.</div>'}</div></div>`
  }
  function taskRow(l,over=false){return `<div class="task" data-open="${l.id}"><div><strong>${esc(l.business)}</strong><div class="muted">${esc(l.status)} · ${esc(l.phone)}</div></div><div><span class="${over?'overdue':'due'}">${fmtDate(l.nextFollowUp)}</span> <button class="call-btn" data-call="${l.id}">Call</button>${messageButton(l)}</div></div>`}
  function renderAnalytics(){
    const bySource={};state.leads.forEach(l=>{bySource[l.source]=bySource[l.source]||{n:0,w:0};bySource[l.source].n++;if(l.status==='Won')bySource[l.source].w++;});
    const byCat={};state.leads.forEach(l=>{byCat[l.category]=byCat[l.category]||{n:0,w:0,val:0};byCat[l.category].n++;if(l.status==='Won'){byCat[l.category].w++;byCat[l.category].val+=Number(l.value||0)}});
    const table=(obj,withValue=false)=>`<table class="lead-table" style="min-width:0"><thead><tr><th>Group</th><th>Leads</th><th>Wins</th><th>Conversion</th>${withValue?'<th>Won value</th>':''}</tr></thead><tbody>${Object.entries(obj).map(([k,v])=>`<tr><td>${esc(k)}</td><td>${v.n}</td><td>${v.w}</td><td>${v.n?Math.round(v.w/v.n*100):0}%</td>${withValue?`<td>${money(v.val)}</td>`:''}</tr>`).join('')}</tbody></table>`;
    return `${statsHtml()}<div class="today-grid"><div class="panel"><h3>Lead source performance</h3>${table(bySource)}</div><div class="panel"><h3>Industry performance</h3>${table(byCat,true)}</div></div>`
  }
  function renderSettings(){
    const redirectUrl=/^https?:$/i.test(location.protocol)?`${location.origin}/`:'Open Browser CRM from FirstSeen Desktop to get the local OAuth redirect URL.';
    const cloudLeadText=cloud.leadCount===null?'':`${cloud.leadCount} cloud lead${cloud.leadCount===1?'':'s'} visible${cloud.leadNames.length?` · ${cloud.leadNames.slice(0,3).map(esc).join(', ')}`:''}`;
    return `<div class="settings-grid"><div class="settings-card"><h3>Desktop CRM connection</h3><div class="integration-state"><span class="state-dot ${connection.connected?'ready':''}"></span>${esc(connection.label)}</div><p class="muted">When opened from FirstSeen Desktop, this browser CRM reads and writes the same live SQLite leads automatically. No CSV import is needed.</p><button class="secondary-btn" data-refresh-desktop>Refresh Desktop Leads</button></div><div class="settings-card"><h3>Twilio Browser Calling</h3><div class="integration-state"><span class="state-dot ${connection.twilio?'ready':''}"></span>${connection.twilio?'Ready for browser calls':'Not configured yet'}</div><p class="muted">Outbound calls run inside FirstSeen through your browser headset. Secrets stay in the secure Desktop backend and the browser only receives short-lived access tokens.</p><div class="settings-actions"><button class="primary-btn" data-twilio-setup>${connection.twilio?'Manage Twilio':'Connect Twilio'}</button>${connection.twilio?'<button class="secondary-btn" data-twilio-test>Test connection</button>':''}</div></div><div class="settings-card"><h3>Lead messaging</h3><p class="muted">FirstSeen creates a personalised draft for each lead. It never sends automatically — you can edit the message before opening your phone's Messages app.</p><div class="form-grid message-settings-form"><input id="outreachWebsite" class="full" placeholder="Public website, e.g. firstseendigital.com.au" value="${esc(outreachMessageSettings.website)}"><input id="outreachEmail" class="full" placeholder="Public email" value="${esc(outreachMessageSettings.email)}"></div><div class="settings-actions"><button class="primary-btn" data-save-message-settings>Save message details</button></div><div class="tiny" data-message-settings-status>${outreachMessageSettings.website?'Ready — drafts will include your website and email.':'Add your public website before sending your first outreach message.'}</div></div><div class="settings-card cloud-settings-card"><h3>Supabase Cloud CRM</h3><div class="integration-state"><span class="state-dot ${cloud.signedIn?'ready':cloud.configured?'pending':''}"></span>${esc(cloud.status)}</div><p class="muted">Supabase is now the shared CRM source for FirstSeen. Desktop SQLite stays as a local mirror/cache while leads sync both ways. New and edited Browser CRM leads are written to Supabase, and Desktop changes are uploaded automatically.</p><div class="form-grid"><input id="supabaseUrl" class="full" placeholder="Supabase Project URL" value="${esc(cloud.url)}"><input id="supabaseKey" class="full" type="password" autocomplete="off" placeholder="Publishable key (sb_publishable_…)" value="${esc(cloud.key)}"></div><div class="cloud-redirect-box"><strong>Supabase Redirect URL</strong><code>${esc(redirectUrl)}</code><button class="secondary-btn" data-copy-cloud-redirect>Copy</button></div><div class="settings-actions wrap-actions"><button class="secondary-btn" data-save-supabase>Save connection</button><button class="primary-btn" data-supabase-login ${cloud.configured?'':'disabled'}>${cloud.signedIn?'Reconnect GitHub':'Sign in with GitHub'}</button><button class="secondary-btn" data-supabase-test ${cloud.signedIn?'':'disabled'}>Test cloud leads</button>${cloud.signedIn?'<button class="secondary-btn" data-supabase-signout>Sign out</button>':''}</div><div class="tiny" data-cloud-status>${cloud.error?esc(cloud.error):(cloudLeadText?esc(cloudLeadText):'Add the redirect URL above to Supabase Authentication → URL Configuration, then sign in with GitHub.')}</div><div class="sync-preview-box"><div class="sync-preview-head"><div><strong>Cloud sync</strong><span>Live Desktop ↔ Supabase</span></div><button class="secondary-btn" data-sync-preview ${cloud.signedIn?'':'disabled'}>${cloudSync.running?'Syncing…':'Sync now'}</button></div><p class="tiny">FirstSeen syncs by stable lead ID. Desktop-only leads upload to Supabase, cloud-only leads mirror into Desktop, and the newest updated record wins. SQLite remains available as the local cache.</p>${syncPreviewHtml()}<div class="sync-live-status">${cloudSync.error?esc(cloudSync.error):esc(cloudSync.status||'Ready to sync')}${cloudSync.lastAt?` · ${esc(new Date(cloudSync.lastAt).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'}))}`:''}</div></div></div><div class="settings-card"><h3>Calling & messaging behaviour</h3><p class="muted">Want to Contact is a Leads sub-view backed by the same Supabase-synced CRM records. Finder businesses marked 👍 Lead are automatically promoted into the full CRM so they can be called or messaged from Desktop or phone. Messages are always opened as editable drafts first.</p><div class="integration-state"><span class="state-dot ready"></span>Call Any Lead + Message Any Lead enabled</div></div></div>`;
  }
  function renderDrawer(){const l=leadById(activeLeadId);if(!l)return closeDrawer();el('drawerBackdrop').classList.remove('hidden');el('leadDrawer').classList.remove('hidden');el('leadDrawer').innerHTML=`<div class="drawer-head"><div><div class="eyebrow">${l.kind==='google-shortlist'?'Finder lead · Want to Contact':'Lead'}</div><h2>${esc(l.business)}</h2></div><button class="icon-btn" data-close-drawer>×</button></div><div class="drawer-body"><div class="lead-hero"><div><span class="status-pill" style="${statusStyle(l.status)}">${esc(l.status)}</span><div class="phone">${esc(l.phone)}</div><div class="muted">${esc(l.suburb)} · ${esc(l.category)} · Lead score ${l.score}</div></div><div class="contact-buttons"><button class="primary-btn" data-call="${l.id}">Call</button>${messageButton(l)}</div></div><div class="drawer-tabs">${(l.kind==='google-shortlist'?[['overview','Overview'],['intel','Call Intel']]:[['overview','Overview'],['intel','Call Intel'],['activity','Activity'],['audit','Audit'],['sales','Sales']]).map(([t,label])=>`<button data-tab="${t}" class="${drawerTab===t?'active':''}">${label}</button>`).join('')}</div>${drawerTabContent(l)}${callLeadId===l.id?renderCallDock(l):''}</div>`;bindDrawerEvents();}
  function drawerTabContent(l){
    if(drawerTab==='overview'){const base=`<div class="detail-grid"><div class="field"><label>Phone</label><div>${esc(l.phone)||'—'}</div></div><div class="field"><label>Email</label><div>${esc(l.email)||'—'}</div></div><div class="field"><label>Website</label><div>${l.website?`<a href="${esc(l.website)}" target="_blank">${esc(l.website)}</a>`:'No website saved'}</div></div><div class="field"><label>Reviews</label><div>${l.rating?`${l.rating}★ · ${l.reviews} reviews`:'—'}</div></div><div class="field"><label>Area</label><div>${esc(l.suburb)||'—'}</div></div><div class="field"><label>Source</label><div>${esc(l.source)||'—'}</div></div></div>`;const summary=l.businessSummary||autoBusinessSummary(l);if(l.kind==='google-shortlist')return `${base}<div class="summary-card"><div class="summary-head"><strong>Business summary</strong><span>Auto summary</span></div><div class="summary-copy">${esc(summary)}</div>${reviewSnapshotHtml(l)}</div><div class="reason"><strong>Why this is here</strong><br>You marked this business 👍 Lead in Finder, so FirstSeen keeps it in Want to Contact even if you have not written notes yet. It remains a Finder shortlist item until you verify/promote it into the full CRM.</div><div class="drawer-call"><button class="primary-btn" data-call="${l.id}">Start call</button>${messageButton(l)}${l.googleMapsUrl?`<a class="secondary-btn link-btn" href="${esc(l.googleMapsUrl)}" target="_blank">Open Maps</a>`:''}${l.website?`<a class="secondary-btn link-btn" href="${esc(l.website)}" target="_blank">Open Website</a>`:''}</div>`;return `${base}<div class="summary-card"><div class="summary-head"><strong>Business summary</strong><span>What they do</span></div><textarea class="summary-textarea" data-business-summary>${esc(summary)}</textarea>${reviewSnapshotHtml(l)}<div class="summary-actions"><button class="secondary-btn" data-generate-summary>Generate summary</button><button class="primary-btn" data-save-summary>Save summary</button></div><div class="tiny summary-status" data-summary-status>New leads get this automatically. You can edit it at any time.</div></div><h3>Notes</h3><textarea class="notes" data-notes>${esc(l.notes)}</textarea><div class="drawer-call"><button class="primary-btn" data-call="${l.id}">Start call</button>${messageButton(l)}<button class="secondary-btn" data-followup="${l.id}">Set follow-up</button><button class="secondary-btn" data-email="${l.id}">Draft email</button></div>`;}
    if(drawerTab==='intel'){
      const chance=answerLikelihood(l),hours=todayHours(l),auditReasons=(l.auditReasons||[]).slice(0,3);
      return `<div class="intel-hero"><div><div class="eyebrow">Answer likelihood</div><div class="intel-score">${chance}%</div><div class="muted">${esc(openStatusLabel(l))}${hours?` · ${esc(hours)}`:''}</div></div><div class="contact-buttons"><button class="primary-btn" data-call="${l.id}">Call now</button>${messageButton(l)}</div></div>
      <div class="detail-grid intel-grid">
        <div class="field"><label>Best call window</label><div>${esc(bestCallWindow(l))}</div></div>
        <div class="field"><label>Business status</label><div>${esc(openStatusLabel(l))}</div></div>
        <div class="field"><label>Google reputation</label><div>${l.rating?`${l.rating}★ · ${l.reviews} reviews`:'Not available'}</div></div>
        <div class="field"><label>Business type</label><div>${esc(l.category)||'—'}${l.serviceAreaBusiness?' · Service-area':''}</div></div>
        <div class="field"><label>Address</label><div>${esc(l.address||l.suburb)||'—'}</div></div>
        <div class="field"><label>Contact readiness</label><div>${l.phone?'Phone ready':'No phone'} · ${l.email?'Email ready':'No email'}</div></div>
      </div>
      <div class="reason"><strong>Why call them</strong><br>${esc(leadReason(l))}</div>
      ${auditReasons.length?`<div class="audit-list">${auditReasons.map(x=>`<div class="audit-item"><strong>Website talking point</strong><div class="muted">${esc(x)}</div></div>`).join('')}</div>`:''}
      <h3>Opening script</h3><div class="script">${esc(callScript(l))}</div>
      <div class="drawer-call">${connection.mode==='desktop'&&l.googlePlaceId?`<button class="secondary-btn" data-enrich="${l.id}">Refresh Call Intel</button>`:''}${l.googleMapsUrl?`<a class="secondary-btn link-btn" href="${esc(l.googleMapsUrl)}" target="_blank">Open Maps</a>`:''}${l.website?`<a class="secondary-btn link-btn" href="${esc(l.website)}" target="_blank">Open Website</a>`:''}${l.kind==='google-shortlist'?'':`<button class="secondary-btn" data-followup="${l.id}">Set follow-up</button>`}</div>`;
    }
    if(drawerTab==='activity')return `<div>${(l.activities||[]).length?(l.activities||[]).map(a=>`<div class="timeline-item"><strong>${esc(a.text)}</strong><span>${fmtDate(a.at)}</span></div>`).join(''):'<div class="empty">No activity yet.</div>'}</div>`;
    if(drawerTab==='audit')return `<div class="audit-list">${audit(l).map(([tone,title,text])=>`<div class="audit-item ${tone}"><strong>${esc(title)}</strong><div class="muted">${esc(text)}</div></div>`).join('')}</div><div class="reason"><strong>Call angle</strong><br>${esc(leadReason(l))}</div>`;
    return `<div class="reason"><strong>Opening script</strong><br>${esc(callScript(l))}</div><h3>Discovery questions</h3><div class="audit-list">${['How are most customers finding you now?','Do you currently get many enquiries through your website or Google?','What work would you most like more of?','If a customer finds you after hours, what do you want them to do?','If I showed you a simple site that solved that, what would you need to see before moving forward?'].map(x=>`<div class="audit-item">${esc(x)}</div>`).join('')}</div><div class="drawer-call"><button class="secondary-btn" data-demo="${l.id}">Create demo brief</button><button class="secondary-btn" data-proposal="${l.id}">Prepare proposal</button></div>`
  }
  function cloneCallScript(model){return JSON.parse(JSON.stringify(model));}
function normalizeCallScriptModel(model){
  if(!model||!Array.isArray(model.sections))return null;
  const sections=model.sections.slice(0,40).map(section=>({
    title:String(section&&section.title||'').trim().slice(0,160),
    blocks:(Array.isArray(section&&section.blocks)?section.blocks:[]).slice(0,30).map(block=>({
      type:block&&block.type==='action'?'action':'speech',
      tone:['yes','no','pause'].includes(block&&block.tone)?block.tone:'',
      text:String(block&&block.text||'').replace(/\r/g,'').trim().slice(0,6000)
    })).filter(block=>block.text)
  })).filter(section=>section.title||section.blocks.length);
  return sections.length?{version:1,sections}:null;
}
function callScriptProspectKey(l){return l&&l.kind==='google-shortlist'?'google:'+(l.googlePlaceId||l.id):'lead:'+(l&&l.id||'');}
function replaceLiteral(value,find,replacement){return find?String(value).split(String(find)).join(replacement):String(value);}
function resolveCallScriptModel(model,l){
  const resolved=cloneCallScript(normalizeCallScriptModel(model)||{version:1,sections:[]});
  const reason=callSpecificReason(l),websiteIssue=callWebsiteIssue(l),business=l.business||'the business';
  for(const section of resolved.sections){
    section.title=section.title.split('{{business}}').join(business).split('{{reason}}').join(reason).split('{{website_issue}}').join(websiteIssue);
    for(const block of section.blocks)block.text=block.text.split('{{business}}').join(business).split('{{reason}}').join(reason).split('{{website_issue}}').join(websiteIssue);
    if(section.title.trim().toUpperCase()==='OPENING'){
      const firstSpeech=section.blocks.find(block=>block.type==='speech');
      if(firstSpeech&&!firstSpeech.text.includes('\n'))firstSpeech.text=firstSpeech.text.replace(/([.!?])\s+(?=[A-Z])/g,'$1\n');
    }
  }
  return resolved;
}
function templateizeCallScriptModel(model,l){
  const out=cloneCallScript(normalizeCallScriptModel(model));
  const reason=callSpecificReason(l),websiteIssue=callWebsiteIssue(l),business=l.business||'';
  for(const section of out.sections){
    section.title=replaceLiteral(replaceLiteral(replaceLiteral(section.title,websiteIssue,'{{website_issue}}'),reason,'{{reason}}'),business,'{{business}}');
    for(const block of section.blocks)block.text=replaceLiteral(replaceLiteral(replaceLiteral(block.text,websiteIssue,'{{website_issue}}'),reason,'{{reason}}'),business,'{{business}}');
  }
  return out;
}
function readCallScriptMirror(){
  try{
    const raw=localStorage.getItem(CALL_SCRIPT_STORE_KEY);
    const parsed=raw?JSON.parse(raw):{};
    return {global:parsed&&parsed.global||null,prospects:parsed&&parsed.prospects&&typeof parsed.prospects==='object'?parsed.prospects:{}};
  }catch{return {global:null,prospects:{}};}
}
function writeCallScriptMirror(store){
  try{localStorage.setItem(CALL_SCRIPT_STORE_KEY,JSON.stringify({global:store.global||null,prospects:store.prospects||{}}));return true;}catch{return false;}
}
function mirrorSaveCallScript(scope,key,script){
  const store=readCallScriptMirror();
  if(scope==='all'){store.global=script;delete store.prospects[key];}
  else store.prospects[key]=script;
  return writeCallScriptMirror(store);
}
function mirrorLoadCallScript(key){
  const store=readCallScriptMirror();
  return store.prospects[key]?{source:'prospect',script:store.prospects[key]}:store.global?{source:'global',script:store.global}:{source:'default',script:null};
}
function captureEditableText(node){return String(node&&node.innerText!==undefined?node.innerText:node&&node.textContent||'').replace(/\r/g,'').replace(/\n{3,}/g,'\n\n').trim();}
function captureCallScriptModel(panel){
  const sections=[...panel.querySelectorAll('.script-section')].map(section=>({
    title:captureEditableText(section.querySelector('[data-script-title]')),
    blocks:[...section.querySelectorAll('[data-script-block]')].map(block=>({type:block.dataset.scriptBlock==='action'?'action':'speech',tone:block.dataset.tone||'',text:captureEditableText(block)})).filter(block=>block.text)
  }));
  return normalizeCallScriptModel({version:1,sections});
}
function applyCallScriptModelToPanel(panel,model){
  const clean=normalizeCallScriptModel(model);if(!clean)return;
  const sections=[...panel.querySelectorAll('.script-section')];
  clean.sections.forEach((saved,i)=>{
    const section=sections[i];if(!section)return;
    const title=section.querySelector('[data-script-title]');if(title)title.textContent=saved.title;
    const blocks=[...section.querySelectorAll('[data-script-block]')];
    saved.blocks.forEach((block,j)=>{if(blocks[j])blocks[j].textContent=block.text;});
  });
}
function desktopScriptBridgeAvailable(){return location.protocol==='http:'&&['127.0.0.1','localhost'].includes(location.hostname);}
function stableScriptJson(model){return JSON.stringify(normalizeCallScriptModel(model)||null);}
function updateCallScriptFooter(message,tone=''){
  const panel=el('callScriptPanel');if(!panel)return;
  const status=panel.querySelector('[data-script-save-status]');
  if(status){status.className='script-save-status '+(tone||'');status.textContent=message||(callScriptDirty?'Unsaved changes':callScriptSaveSource==='prospect'?'Saved for this prospect':callScriptSaveSource==='global'?'Using your saved script for all prospects':'Using the FirstSeen default script');}
  panel.querySelectorAll('.script-save-actions button').forEach(button=>button.disabled=callScriptSaving);
}
async function loadCallScriptForLead(l){
  const key=callScriptProspectKey(l);
  let chosen=mirrorLoadCallScript(key);
  let desktopLoaded=false;
  if(desktopScriptBridgeAvailable()){
    try{
      const remote=await api('/api/call-script?prospectKey='+encodeURIComponent(key));
      desktopLoaded=true;
      if(remote&&remote.script){
        chosen={source:remote.source||'default',script:remote.script};
        if(chosen.source==='global')mirrorSaveCallScript('all',key,chosen.script);
        else if(chosen.source==='prospect')mirrorSaveCallScript('prospect',key,chosen.script);
      }
    }catch(error){
      updateCallScriptFooter('Desktop save store unavailable — using browser backup.','warning');
    }
  }
  const panel=el('callScriptPanel');
  if(chosen.script&&panel){
    callScriptModel=resolveCallScriptModel(chosen.script,l);
    applyCallScriptModelToPanel(panel,callScriptModel);
  }else if(panel){
    callScriptModel=captureCallScriptModel(panel);
  }
  callScriptSavedModel=cloneCallScript(callScriptModel);
  callScriptSaveSource=chosen.source||'default';
  callScriptDirty=false;callScriptSaving=false;
  if(desktopLoaded||chosen.script)updateCallScriptFooter();
}
async function persistCallScript(scope,key,script){
  const mirrored=mirrorSaveCallScript(scope,key,script);
  let desktopSaved=false,desktopError='';
  if(desktopScriptBridgeAvailable()){
    try{
      const result=await api('/api/call-script',{method:'POST',body:JSON.stringify({scope,prospectKey:key,script})});
      if(!result||result.ok!==true)throw new Error('Desktop did not confirm the save.');
      const verify=await api('/api/call-script?prospectKey='+encodeURIComponent(key));
      if(!verify||!verify.script)throw new Error('Desktop could not read the script back after saving.');
      if(stableScriptJson(verify.script)!==stableScriptJson(script))throw new Error('Desktop save verification did not match the edited script.');
      desktopSaved=true;
    }catch(error){desktopError=error.message||'Desktop save failed.';}
  }
  if(!mirrored&&!desktopSaved)throw new Error(desktopError||'The browser could not store the script.');
  return {mirrored,desktopSaved,desktopError};
}
async function saveEditedCallScript(scope){
  const l=leadById(scriptLeadId||callLeadId),panel=el('callScriptPanel');if(!l||!panel||callScriptSaving)return;
  const model=captureCallScriptModel(panel);
  if(!model){updateCallScriptFooter('Nothing to save.','error');return;}
  const key=callScriptProspectKey(l),payload=scope==='all'?templateizeCallScriptModel(model,l):model;
  callScriptSaving=true;updateCallScriptFooter('Saving…');
  try{
    const result=await persistCallScript(scope,key,payload);
    callScriptSaveSource=scope==='all'?'global':'prospect';
    callScriptModel=cloneCallScript(model);callScriptSavedModel=cloneCallScript(model);callScriptDirty=false;
    if(result.desktopSaved&&result.mirrored)updateCallScriptFooter(scope==='all'?'Saved for all prospects ✓':'Saved for this prospect ✓','success');
    else if(result.desktopSaved)updateCallScriptFooter(scope==='all'?'Saved for all prospects in Desktop ✓':'Saved for this prospect in Desktop ✓','success');
    else updateCallScriptFooter((scope==='all'?'Saved for all prospects':'Saved for this prospect')+' in browser backup ✓ — Desktop sync will retry next time.','warning');
  }catch(error){
    updateCallScriptFooter('Save failed — '+(error.message||'try again'),'error');
    alert(error.message||'Could not save the call script.');
  }finally{
    callScriptSaving=false;
    const panelNow=el('callScriptPanel');if(panelNow)panelNow.querySelectorAll('.script-save-actions button').forEach(button=>button.disabled=false);
  }
}
function discardEditedCallScript(){
  const panel=el('callScriptPanel');if(panel&&callScriptSavedModel)applyCallScriptModelToPanel(panel,callScriptSavedModel);
  callScriptDirty=false;updateCallScriptFooter("Changes discarded — nothing saved.",'neutral');
}
function bindCallScriptEditor(panel,l){
  if(callScriptModel)applyCallScriptModelToPanel(panel,callScriptModel);else callScriptModel=captureCallScriptModel(panel);
  if(!callScriptSavedModel)callScriptSavedModel=cloneCallScript(callScriptModel);
  panel.insertAdjacentHTML('beforeend',"<div class=\"script-save-bar\"><div class=\"script-save-status\" data-script-save-status></div><div class=\"script-save-actions\"><button type=\"button\" data-script-save-prospect>Save for the prospect</button><button type=\"button\" class=\"save-all\" data-script-save-all>Save for all prospects</button><button type=\"button\" class=\"dont-save\" data-script-dont-save>Don't save</button></div></div>");
  panel.querySelectorAll('[contenteditable=\"true\"]').forEach(node=>node.addEventListener('input',()=>{callScriptDirty=true;updateCallScriptFooter();}));
  panel.onclick=async event=>{
    const prospectButton=event.target.closest('[data-script-save-prospect]');
    const allButton=event.target.closest('[data-script-save-all]');
    const discardButton=event.target.closest('[data-script-dont-save]');
    const closeButton=event.target.closest('[data-close-call-script]');
    if(prospectButton){event.preventDefault();event.stopPropagation();await saveEditedCallScript('prospect');return;}
    if(allButton){event.preventDefault();event.stopPropagation();await saveEditedCallScript('all');return;}
    if(discardButton){event.preventDefault();event.stopPropagation();discardEditedCallScript();return;}
    if(closeButton){event.preventDefault();callScriptPanelOpen=false;renderCallScriptPanel();}
  };
  updateCallScriptFooter();
}
  function scriptSpeech(text){return `<div class="script-speech" contenteditable="true" spellcheck="true" data-script-block="speech">${esc(text)}</div>`;}
function scriptAction(text,tone=''){return `<div class="script-action ${tone}" contenteditable="true" spellcheck="true" data-script-block="action" data-tone="${esc(tone)}">${esc(text)}</div>`;}
function scriptSection(title,body){return `<section class="script-section"><div class="script-section-title" contenteditable="true" spellcheck="true" data-script-title>${esc(title)}</div>${body}</section>`;}
function renderCallScriptPanel(){
const panel=el('callScriptPanel'); if(!panel)return;
const l=leadById(scriptLeadId||callLeadId);
if(!callScriptPanelOpen||!l){panel.classList.add('hidden');panel.innerHTML='';return;}
const reason=callSpecificReason(l), websiteIssue=callWebsiteIssue(l);
panel.innerHTML=`<div class="script-panel-head"><div><div class="script-kicker">FirstSeen cold call · delivery guide</div><h2>${esc(l.business)}</h2><div class="script-lead-meta">${esc(normalizePhone(l.phone)||l.phone)}${l.suburb?` · ${esc(l.suburb)}`:''}</div><div class="script-business-summary"><strong>What they do:</strong> ${esc(l.businessSummary||autoBusinessSummary(l))}</div>${reviewSnapshot(l)?`<div class="script-review-snapshot">${esc(reviewSnapshot(l))}${l.googleMapsUrl?' · Google Maps':''}</div>`:''}</div><button class="script-close" data-close-call-script aria-label="Close script">×</button></div>
  <div class="script-panel-scroll">
    ${scriptSection('OPENING',
      scriptAction('Normal','pause')+
      scriptSpeech(`Hey, is this ${l.business}?`)+
      scriptAction('Pause and let them answer.','pause')+
      scriptAction('Slightly slower','pause')+
      scriptSpeech('Harvey here from FirstSeen.')+
      scriptAction('Normal','pause')+
      scriptSpeech(`I found your business online and noticed ${reason}.`)+
      scriptSpeech('I build websites for local businesses, and I think I could help.')+
      scriptAction('Slow down on this bit','pause')+
      scriptSpeech('I’m just looking to grab 10 minutes with you sometime this week and show you what I mean.')+
      scriptAction('Slow, relaxed','pause')+
      scriptSpeech('Would you be open to that?')+
      scriptAction('Then stop talking. Don’t rush to fill the silence.','pause'))}
    ${scriptSection('IF YES',
      scriptAction('Sound a little brighter, but don’t suddenly get overexcited.','pause')+
      scriptSpeech('Perfect. What day works best for you?')+
      scriptAction('Book the time.','yes'))}
    ${scriptSection('WHAT DO YOU ACTUALLY DO?',
      scriptSpeech('I build strong websites for local businesses that want a stronger online presence and more enquiries.')+
      scriptSpeech('I just want 10 minutes to show you what I think could work for your business.')+
      scriptAction('Pause slightly.','pause')+
      scriptSpeech('Would you be open to that?'))}
    ${scriptSection('HOW MUCH DOES IT COST?',
      scriptAction('Don’t rush into defending a price.','pause')+
      scriptSpeech('It depends on what you actually need, so I don’t want to throw a random number at you.')+
      scriptSpeech('If you give me 10 minutes, I can show you what I’d recommend and what it would cost.')+
      scriptSpeech('Would you be open to that?'))}
    ${scriptSection('I’M NOT INTERESTED',
      scriptAction('Slow down here. Don’t sound defensive.','pause')+
      scriptSpeech('No problem.')+
      scriptAction('Small pause.','pause')+
      scriptSpeech('Is that because you’re happy with what you’ve already got, or you just don’t see a need for a website?')+
      scriptAction('Then listen.','pause')+
      scriptAction('If they give you a reason, respond briefly to that reason, then:','pause')+
      scriptSpeech('Fair enough. If I could show you something relevant in 10 minutes, would you be open to having a look?')+
      scriptAction('YES → Book the time.','yes')+
      scriptAction('NO → End the call.','no'))}
    ${scriptSection('WE DON’T NEED A WEBSITE',
      scriptSpeech('That’s fair.')+
      scriptSpeech(`I noticed ${reason}, which is why I reached out.`)+
      scriptSpeech('I’m not saying you need one — I’d just like to show you where I think there could be an opportunity.')+
      scriptSpeech('Would you be open to a quick 10-minute look?'))}
    ${scriptSection('WE ALREADY GET ENOUGH WORK',
      scriptSpeech('That makes sense.')+
      scriptSpeech('The goal wouldn’t necessarily be just more work — it could also be helping you look more established online and making it easier for customers to find the right information.')+
      scriptSpeech('Would it still be worth 10 minutes to have a look?'))}
    ${scriptSection('WE ALREADY HAVE A WEBSITE',
      scriptSpeech('Yeah, I saw that.')+
      scriptSpeech(`I’m reaching out because I noticed ${websiteIssue}.`)+
      scriptSpeech('I think there are a few things that could be improved, and I’d like to show you what I mean.')+
      scriptSpeech('Would you be open to 10 minutes sometime this week?'))}
    ${scriptSection('SEND ME AN EMAIL',
      scriptSpeech('Yeah, I can do that.')+
      scriptSpeech('I’ll keep it short. What’s the best email for you?')+
      scriptAction('Get the email.','pause')+
      scriptSpeech('Would it be alright if I give you a quick call after you’ve had a look?')+
      scriptAction('YES → Set a follow-up.','yes')+
      scriptAction('NO → Send the email and leave it there.','no'))}
    ${scriptSection('I’M BUSY',
      scriptAction('Don’t try to keep pitching.','pause')+
      scriptSpeech('No problem.')+
      scriptSpeech('When would be a better time for me to call you back?')+
      scriptAction('Get a specific day/time.','pause'))}
    ${scriptSection('CALL ME LATER',
      scriptSpeech('Sure.')+
      scriptSpeech('What day and time works best?')+
      scriptAction('Book the callback.','yes'))}
    ${scriptSection('NO ANSWER / VOICEMAIL',
      scriptAction('Keep this slow and very low-pressure.','pause')+
      scriptSpeech('Hey, Harvey here from FirstSeen.')+
      scriptSpeech(`I was just giving you a quick call about ${l.business}.`)+
      scriptSpeech('Nothing urgent — I’ll try you again another time.')+
      scriptSpeech('Thanks.'))}
    ${scriptSection('DELIVERY RULES',
      scriptAction('Use a normal conversational pace for most of the call.','pause')+
      scriptAction('Deliberately slow down around “Harvey here from FirstSeen”, “10 minutes”, and the final question.','pause')+
      scriptAction('When they object, slow down rather than speeding up.','pause')+
      scriptAction('Pause after questions, actually listen, and don’t stack arguments on top of them.','pause')+
      scriptAction('Once they agree to a meeting or callback, stop selling and book it.','yes')+
      scriptAction('Rhythm: Say it → ask → pause → listen → respond briefly → ask again.','pause'))}
  </div>`;
panel.classList.remove('hidden');
bindCallScriptEditor(panel,l);

}
function renderCallDock(l){
    const statusLabel={idle:'Ready',starting:'Starting Twilio…',ready:'Ready',dialling:'Dialling…',ringing:'Ringing…',connected:'Connected',ended:'Call ended',error:'Call error'}[voice.state]||voice.state;
    const twilioActive=Boolean(connection.twilio); const active=Boolean(voice.call);
    return `<div class="call-dock"><div class="call-dock-top"><div><strong>${twilioActive?'Browser call':'Call tracking'}</strong><div class="tiny">${esc(l.business)} · ${esc(normalizePhone(l.phone)||l.phone)}</div></div><div class="call-status-stack"><span class="call-state ${esc(voice.state)}">${esc(twilioActive?statusLabel:'Device dialler')}</span><div class="call-timer" id="callTimer">${callStart?'00:00':'--:--'}</div></div></div>${voice.error?`<div class="call-error">${esc(voice.error)}</div>`:''}<div class="call-controls">${twilioActive?`<button data-call-control="mute" ${active?'':'disabled'}>${voice.muted?'Unmute':'Mute'}</button><button data-call-control="keypad" ${active?'':'disabled'}>Keypad</button><button class="danger-call" data-call-control="hangup" ${active||['dialling','ringing','connected'].includes(voice.state)?'':'disabled'}>Hang up</button>`:'<span class="tiny">Twilio is not connected. FirstSeen can still open your device dialler.</span>'}</div>${voice.keypad&&active?`<div class="dtmf-grid">${['1','2','3','4','5','6','7','8','9','*','0','#'].map(d=>`<button data-dtmf="${d}">${d}</button>`).join('')}</div>`:''}<div class="call-outcome-label">Finish by choosing the call outcome</div><div class="outcome-grid">${['No Answer','Spoke To','Send Info','Follow Up','Meeting Booked','Quote Sent','Won','Lost'].map(o=>`<button data-outcome="${o}">${o}</button>`).join('')}</div></div>`;
  }
  function closeDrawer(){activeLeadId=null;el('leadDrawer').classList.add('hidden');el('drawerBackdrop').classList.add('hidden');if(!callLeadId){scriptLeadId=null;callScriptPanelOpen=false;callScriptModel=null;callScriptSavedModel=null;callScriptSaveSource='default';callScriptDirty=false;renderCallScriptPanel();}}
  async function startCall(id){
    const l=leadById(id);if(!l)return;if(!l.phone){alert(`No phone number is saved for ${l.business}.`);return;}
    callLeadId=id;callStart=null;clearInterval(callTimer);callTimer=null;voice.error='';voice.state=connection.twilio?'starting':'idle';if(activeLeadId!==id){await openLead(id);}else{renderDrawer();if(scriptLeadId!==id||!callScriptPanelOpen)await showCallScriptForLead(id);else renderCallScriptPanel();}
    if(connection.twilio){
      try{await placeBrowserCall(l);renderDrawer();}
      catch(error){voice.error=error.message||'Could not start browser call.';voice.state='error';renderDrawer();}
    }else{
      setTimeout(()=>{if(confirm(`Twilio Browser Calling is not connected yet. Open your device dialler for ${l.phone}?`)){callStart=Date.now();callTimer=setInterval(updateTimer,1000);location.href=`tel:${l.phone.replace(/\s/g,'')}`;renderDrawer();}},50);
    }
  }
  function updateTimer(){const t=document.getElementById('callTimer');if(!t||!callStart)return;const s=Math.floor((Date.now()-callStart)/1000);t.textContent=`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`}
  async function finishCall(outcome){const l=leadById(callLeadId);if(!l)return;if(voice.call){try{voice.call.disconnect();}catch{}}const secs=callStart?Math.floor((Date.now()-callStart)/1000):0;
    if(connection.mode==='desktop'){
      const map={'No Answer':'no_answer','Spoke To':'spoke','Send Info':'send_info','Follow Up':'follow_up','Meeting Booked':'meeting_booked','Quote Sent':'quote_sent','Won':'won','Lost':'not_interested'};
      try{
        const endpoint=l.kind==='google-shortlist'?`/api/contact-intent/${encodeURIComponent(l.googlePlaceId)}/call-outcome`:`/api/leads/${encodeURIComponent(l.id)}/call-outcome`;
        await api(endpoint,{method:'POST',body:JSON.stringify({outcome:map[outcome],note:`Browser CRM call · ${Math.floor(secs/60)}m ${secs%60}s${voice.lastCallSid?` · Twilio ${voice.lastCallSid}`:''}`})});await refreshDesktopData({quiet:true});if(cloud.signedIn&&l.kind!=='google-shortlist'){const updated=leadById(l.id);if(updated)await upsertLeadToCloud(updated);}
      }catch(error){alert(error.message||'Could not save the call outcome to Desktop.');return;}
    }else{
      let status=outcome;if(outcome==='No Answer')status='Attempted';if(outcome==='Send Info')status='Follow Up';if(outcome==='Spoke To')status='Spoke To';l.status=status;l.lastContacted=nowIsoLocal();
      if(outcome==='No Answer')l.nextFollowUp=addDaysLocal(2,10);if(outcome==='Send Info')l.nextFollowUp=addDaysLocal(1,10);if(outcome==='Follow Up')l.nextFollowUp=addDaysLocal(3,10);if(outcome==='Quote Sent')l.nextFollowUp=addDaysLocal(3,10);logEvent(l,'call',`${outcome} · ${Math.floor(secs/60)}m ${secs%60}s`);if(cloud.signedIn)await patchCloudLead(l.id,{status:l.status,lastContacted:l.lastContacted,nextFollowUp:l.nextFollowUp});
    }
    clearInterval(callTimer);callTimer=null;callLeadId=null;callStart=null;voice.call=null;voice.state='idle';voice.error='';voice.muted=false;voice.keypad=false;if(activeLeadId){scriptLeadId=activeLeadId;callScriptPanelOpen=true;}else{scriptLeadId=null;callScriptPanelOpen=false;}renderCallScriptPanel();render();if(activeLeadId)renderDrawer();
  }
  function addDaysLocal(days,hour){const d=new Date();d.setDate(d.getDate()+days);d.setHours(hour,0,0,0);d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,16)}

  function showModal(html){el('modal').innerHTML=html;el('modal').classList.remove('hidden');el('modalBackdrop').classList.remove('hidden')}
  function closeModal(){el('modal').classList.add('hidden');el('modalBackdrop').classList.add('hidden')}
  function addLeadModal(){showModal(`<h2>Add Lead</h2><div class="form-grid"><input id="mBusiness" class="full" placeholder="Business name"><input id="mPhone" placeholder="Phone"><input id="mEmail" placeholder="Email"><input id="mWebsite" class="full" placeholder="Website"><input id="mSuburb" placeholder="Suburb"><input id="mCategory" placeholder="Industry"><select id="mSource"><option>Google Maps</option><option>Facebook</option><option>Referral</option><option>Manual</option></select><input id="mScore" type="number" value="70" min="0" max="100"><input id="mValue" type="number" value="750" min="0"><textarea id="mSummary" class="full" placeholder="Business summary — leave blank and FirstSeen will create one automatically"></textarea><textarea id="mNotes" class="full" placeholder="Notes"></textarea></div><div class="modal-actions"><button class="secondary-btn" data-modal-close>Cancel</button><button class="primary-btn" data-save-lead>Save lead</button></div>`);bindModalEvents()}
  function followupModal(id){const l=leadById(id);showModal(`<h2>Set Follow-up</h2><p class="muted">${esc(l.business)}</p><div class="form-grid"><input id="mFollow" class="full" type="datetime-local" value="${esc(l.nextFollowUp||addDaysLocal(2,10))}"></div><div class="modal-actions"><button class="secondary-btn" data-modal-close>Cancel</button><button class="primary-btn" data-save-followup="${id}">Save follow-up</button></div>`);bindModalEvents()}
  function emailModal(id){const l=leadById(id);const body=`Hi,\n\nThanks for your time earlier. I run FirstSeen Digital and help local businesses make it easier for customers to find them and get in touch online.\n\nI had a look at ${l.business}${!l.website?' and noticed there does not appear to be a dedicated website at the moment':'.'} If it helps, I can put together a simple example of what I would recommend and run you through it in about 10 minutes.\n\nCheers,\nHarvey\nFirstSeen Digital`;
    showModal(`<h2>Follow-up Email</h2><div class="form-grid"><input id="mEmailTo" class="full" value="${esc(l.email)}" placeholder="Email address"><input id="mEmailSubject" class="full" value="FirstSeen Digital — ${esc(l.business)}"><textarea id="mEmailBody" class="full" style="min-height:220px">${esc(body)}</textarea></div><div class="modal-actions"><button class="secondary-btn" data-modal-close>Close</button><button class="primary-btn" data-copy-email="${id}">Copy email</button></div>`);bindModalEvents()}
  function messageModal(id){
    const l=leadById(id);if(!l)return;if(!l.phone)return alert(`No phone number is saved for ${l.business}.`);
    const body=outreachMessage(l),websiteReady=Boolean(String(outreachMessageSettings.website||'').trim());
    showModal(`<h2>Message ${esc(l.business)}</h2><p class="muted">Personalised from the same lead intel as your call script. Edit anything you want before sending.</p><div class="message-preview-meta"><strong>${esc(normalizePhone(l.phone)||l.phone)}</strong><span>${esc(callSpecificReason(l))}</span></div><textarea id="mMessageBody" class="message-draft" spellcheck="true">${esc(body)}</textarea>${websiteReady?'':`<div class="message-warning">Your FirstSeen website is not set yet. Add it in Settings or type it into this draft before sending.</div>`}<div class="tiny">FirstSeen does not send this automatically. Open Messages to review it in your phone's SMS app, or copy the text.</div><div class="modal-actions wrap-actions"><button class="secondary-btn" data-modal-close>Close</button><button class="secondary-btn" data-copy-message="${esc(id)}">Copy message</button><button class="primary-btn" data-open-message="${esc(id)}">Open Messages</button></div>`);bindModalEvents();
  }
  function quickCallModal(){
    const callable=allCallableLeads().sort((a,b)=>a.business.localeCompare(b.business));
    showModal(`<h2>Call Any Lead</h2><p class="muted">This list includes every lead with a phone number — they do not need to be in the Call Queue.</p><div class="form-grid"><select id="mQuickLead" class="full">${callable.map(l=>`<option value="${esc(l.id)}">${esc(l.business)} — ${esc(l.phone)} — ${esc(l.status)}</option>`).join('')}</select></div><div class="modal-actions"><button class="secondary-btn" data-modal-close>Cancel</button><button class="primary-btn" data-quick-call ${callable.length?'':'disabled'}>Call selected lead</button></div>`);
    bindModalEvents();
  }

  function infoModal(type){const txt=type==='supabase'?`Connect Supabase to move this prototype from local browser storage to secure login + cloud CRM data.`:`Twilio Browser Calling is now built into FirstSeen V2. Configure it from Settings → Twilio Browser Calling.`;showModal(`<h2>${type==='supabase'?'Supabase':'Twilio'} setup</h2><p>${esc(txt)}</p><div class="modal-actions"><button class="primary-btn" data-modal-close>Got it</button></div>`);bindModalEvents()}

  async function twilioSetupModal(){
    if(connection.mode!=='desktop')return alert('Secure Twilio setup is available when Browser CRM is opened from FirstSeen Desktop.');
    let cfg={};try{cfg=await api('/api/twilio/config');}catch(error){return alert(error.message||'Could not read Twilio settings.');}
    const template=`<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Dial callerId="{{CallerId}}" answerOnBridge="true">\n    <Number>{{To}}</Number>\n  </Dial>\n</Response>`;
    showModal(`<h2>Twilio Browser Calling</h2><p class="muted">These details are stored by FirstSeen Desktop using Windows OS-backed encryption. Your API Key Secret is never sent back to this page.</p><div class="form-grid"><input id="twAccountSid" class="full" placeholder="Account SID (AC…)" value="${esc(cfg.accountSid||'')}"><input id="twApiKeySid" placeholder="API Key SID (SK…)" value="${esc(cfg.apiKeySid||'')}"><input id="twApiKeySecret" type="password" placeholder="API Key Secret${cfg.apiKeySecretSet?' — leave blank to keep saved secret':''}"><input id="twAppSid" placeholder="TwiML App SID (AP…)" value="${esc(cfg.twimlAppSid||'')}"><input id="twCallerId" placeholder="Twilio caller number (+61…)" value="${esc(cfg.callerId||'')}"><input id="twIdentity" placeholder="Device identity" value="${esc(cfg.identity||'firstseen_harvey')}"><input id="twCountry" placeholder="Default country code" value="${esc(cfg.countryCode||'+61')}"><select id="twEdge"><option value="roaming" ${(cfg.edge||'roaming')==='roaming'?'selected':''}>Automatic nearest edge</option><option value="sydney" ${cfg.edge==='sydney'?'selected':''}>Sydney edge</option></select><input id="twVoiceUrl" class="full" placeholder="TwiML Bin / Voice URL (https://handler.twilio.com/…)" value="${esc(cfg.voiceUrl||'')}"><textarea id="twTemplate" class="full" readonly style="min-height:145px;font-family:monospace">${esc(template)}</textarea></div><div class="reason"><strong>One Twilio-side step</strong><br>Create a TwiML Bin with the template above. Paste its handler URL here. If you already have a TwiML App SID, FirstSeen can update its Voice URL. If the App SID is blank, FirstSeen can create the TwiML App for you.</div><div id="twSetupStatus" class="muted"></div><div class="modal-actions wrap-actions"><button class="secondary-btn" data-copy-twiml>Copy TwiML</button><button class="secondary-btn" data-twilio-clear>Disconnect</button><button class="secondary-btn" data-twilio-save>Save</button><button class="primary-btn" data-twilio-bootstrap>Save + configure TwiML App</button></div>`);bindModalEvents();
  }
  async function testTwilioConnection(){
    try{const result=await api('/api/twilio/test',{method:'POST',body:'{}'});alert(`Twilio connected. ${result.appName||'TwiML App'}${result.voiceUrl?`\nVoice URL: ${result.voiceUrl}`:''}`);await refreshIntegrationStatus();render();}
    catch(error){alert(error.message||'Twilio connection test failed.');}
  }


  function bindViewEvents(){
    document.querySelectorAll('[data-open]').forEach(n=>n.onclick=e=>{if(e.target.closest('[data-call],[data-message]'))return;openLead(n.dataset.open)});
    document.querySelectorAll('[data-call]').forEach(b=>b.onclick=e=>{e.stopPropagation();startCall(b.dataset.call)});
    document.querySelectorAll('[data-message]').forEach(b=>b.onclick=e=>{e.stopPropagation();messageModal(b.dataset.message)});
    document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{boardFilter=b.dataset.filter;render()});
    document.querySelectorAll('[data-queue]').forEach(n=>n.onclick=()=>{callLeadId=n.dataset.queue;render()});
    document.querySelectorAll('[data-skip]').forEach(b=>b.onclick=()=>{const q=getQueue();const idx=q.findIndex(x=>x.id===b.dataset.skip);if(idx>=0){q[idx].score=Math.max(0,q[idx].score-1);save();render()}});
    document.querySelectorAll('[data-drag]').forEach(c=>c.ondragstart=e=>e.dataTransfer.setData('text/plain',c.dataset.drag));
    document.querySelectorAll('[data-drop]').forEach(d=>{d.parentElement.ondragover=e=>e.preventDefault();d.parentElement.ondrop=async e=>{e.preventDefault();const id=e.dataTransfer.getData('text/plain'),l=leadById(id);if(l){try{await patchLead(id,{status:d.dataset.drop});}catch(error){alert(error.message||'Could not update the pipeline.');}}}});
    document.querySelectorAll('[data-info]').forEach(b=>b.onclick=()=>infoModal(b.dataset.info));
    const refresh=document.querySelector('[data-refresh-desktop]');if(refresh)refresh.onclick=async()=>{refresh.disabled=true;refresh.textContent='Refreshing…';await refreshDesktopData();};
    const twSetup=document.querySelector('[data-twilio-setup]');if(twSetup)twSetup.onclick=twilioSetupModal;
    const twTest=document.querySelector('[data-twilio-test]');if(twTest)twTest.onclick=testTwilioConnection;
    const saveMessageSettings=document.querySelector('[data-save-message-settings]');if(saveMessageSettings)saveMessageSettings.onclick=async()=>{const status=document.querySelector('[data-message-settings-status]');saveMessageSettings.disabled=true;if(status)status.textContent='Saving…';try{await saveOutreachMessageSettings(el('outreachWebsite').value,el('outreachEmail').value);if(status)status.textContent='Saved — new message drafts will use these details.';}catch(error){if(status)status.textContent='Could not save message details.';alert(error.message||'Could not save message details.');}finally{saveMessageSettings.disabled=false;}};
    const saveCloud=document.querySelector('[data-save-supabase]');if(saveCloud)saveCloud.onclick=async()=>{const st=document.querySelector('[data-cloud-status]');saveCloud.disabled=true;if(st)st.textContent='Saving Supabase connection…';try{await saveSupabaseConfig(el('supabaseUrl').value,el('supabaseKey').value);await refreshCloudConnection();render();}catch(error){if(st)st.textContent=error.message||'Could not save Supabase connection.';alert(error.message||'Could not save Supabase connection.');}finally{saveCloud.disabled=false;}};
    const cloudLogin=document.querySelector('[data-supabase-login]');if(cloudLogin)cloudLogin.onclick=async()=>{try{await signInSupabase();}catch(error){alert(error.message||'Could not start GitHub sign-in.');}};
    const cloudTest=document.querySelector('[data-supabase-test]');if(cloudTest)cloudTest.onclick=async()=>{const st=document.querySelector('[data-cloud-status]');cloudTest.disabled=true;if(st)st.textContent='Reading cloud leads through Row Level Security…';await refreshCloudConnection({fetchLeads:true});render();};
    const syncPreviewButton=document.querySelector('[data-sync-preview]');if(syncPreviewButton)syncPreviewButton.onclick=()=>fullCloudSync();
    const cloudSignout=document.querySelector('[data-supabase-signout]');if(cloudSignout)cloudSignout.onclick=async()=>{try{await signOutSupabase();render();}catch(error){alert(error.message||'Could not sign out of Supabase.');}};
    const copyRedirect=document.querySelector('[data-copy-cloud-redirect]');if(copyRedirect)copyRedirect.onclick=async()=>{const value=/^https?:$/i.test(location.protocol)?`${location.origin}/`:'';if(!value)return alert('Open Browser CRM from FirstSeen Desktop first.');try{await navigator.clipboard.writeText(value);copyRedirect.textContent='Copied';}catch{alert(`Add this redirect URL in Supabase:\n${value}`);}};
  }
  function bindDrawerEvents(){
    const c=document.querySelector('[data-close-drawer]');if(c)c.onclick=closeDrawer;
    document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{drawerTab=b.dataset.tab;renderDrawer()});
    document.querySelectorAll('#leadDrawer [data-call]').forEach(b=>b.onclick=()=>startCall(b.dataset.call));
    document.querySelectorAll('#leadDrawer [data-message]').forEach(b=>b.onclick=()=>messageModal(b.dataset.message));
    const notes=document.querySelector('[data-notes]');if(notes)notes.onchange=async()=>{const l=leadById(activeLeadId);try{await patchLead(l.id,{notes:notes.value});}catch(error){alert(error.message||'Could not save notes.');}};
    const generateSummary=document.querySelector('[data-generate-summary]');if(generateSummary)generateSummary.onclick=()=>{const l=leadById(activeLeadId),box=document.querySelector('[data-business-summary]');if(!l||!box)return;box.value=autoBusinessSummary(l);const st=document.querySelector('[data-summary-status]');if(st)st.textContent='Generated. Press Save summary to keep it.';};
    const saveSummary=document.querySelector('[data-save-summary]');if(saveSummary)saveSummary.onclick=async()=>{const l=leadById(activeLeadId),box=document.querySelector('[data-business-summary]'),st=document.querySelector('[data-summary-status]');if(!l||!box)return;const value=box.value.trim()||autoBusinessSummary(l);saveSummary.disabled=true;if(st)st.textContent='Saving…';try{await patchLead(l.id,{businessSummary:value});if(st)st.textContent='Summary saved.';}catch(error){if(st)st.textContent='Could not save summary.';alert(error.message||'Could not save summary.');}finally{saveSummary.disabled=false;}};
    document.querySelectorAll('[data-outcome]').forEach(b=>b.onclick=()=>finishCall(b.dataset.outcome));
    document.querySelectorAll('[data-call-control]').forEach(b=>b.onclick=()=>{const action=b.dataset.callControl;if(action==='mute')toggleVoiceMute();if(action==='hangup')hangupVoiceCall();if(action==='keypad'){voice.keypad=!voice.keypad;renderDrawer();}});
    document.querySelectorAll('[data-dtmf]').forEach(b=>b.onclick=()=>sendVoiceDigit(b.dataset.dtmf));
    document.querySelectorAll('[data-followup]').forEach(b=>b.onclick=()=>followupModal(b.dataset.followup));
    document.querySelectorAll('[data-email]').forEach(b=>b.onclick=()=>emailModal(b.dataset.email));
    document.querySelectorAll('[data-enrich]').forEach(b=>b.onclick=async()=>{const id=b.dataset.enrich;b.disabled=true;b.textContent='Refreshing…';try{const lead=leadById(id);const endpoint=lead?.kind==='google-shortlist'?`/api/contact-intent/${encodeURIComponent(lead.googlePlaceId)}/enrich-call-intel`:`/api/leads/${encodeURIComponent(id)}/enrich-call-intel`;await api(endpoint,{method:'POST',body:'{}'});await refreshDesktopData({quiet:true});render();renderDrawer();}catch(error){alert(error.message||'Could not refresh call intel.');b.disabled=false;b.textContent='Refresh Call Intel';}});
    document.querySelectorAll('[data-demo]').forEach(b=>b.onclick=()=>{const l=leadById(b.dataset.demo);logEvent(l,'demo','Demo brief created');alert(`Demo brief created for ${l.business}. In the connected version this will open the Website Editor with the lead data prefilled.`);renderDrawer()});
    document.querySelectorAll('[data-proposal]').forEach(b=>b.onclick=async()=>{const l=leadById(b.dataset.proposal);try{await patchLead(l.id,{status:'Quote Sent',nextFollowUp:addDaysLocal(3,10)});}catch(error){alert(error.message||'Could not update the lead.');}});
  }
  function bindModalEvents(){
    document.querySelectorAll('[data-modal-close]').forEach(b=>b.onclick=closeModal);
    const saveLead=document.querySelector('[data-save-lead]');if(saveLead)saveLead.onclick=async()=>{const business=el('mBusiness').value.trim();if(!business)return alert('Business name is required.');const input={business,phone:el('mPhone').value.trim(),email:el('mEmail').value.trim(),website:el('mWebsite').value.trim(),suburb:el('mSuburb').value.trim(),category:el('mCategory').value.trim(),source:el('mSource').value,score:Number(el('mScore').value||70),value:Number(el('mValue').value||0),businessSummary:el('mSummary').value.trim(),notes:el('mNotes').value.trim()};if(!input.businessSummary)input.businessSummary=autoBusinessSummary(input);try{if(connection.mode==='desktop'){const result=await api('/api/leads',{method:'POST',body:JSON.stringify(input)});await refreshDesktopData({quiet:true});if(cloud.signedIn&&result.lead){const local=state.leads.find(x=>x.id===result.lead.id)||mapDesktopLead(result.lead);await upsertLeadToCloud(local);}}else if(cloud.signedIn){const row=await insertCloudLeadFromInput(input);state.leads.unshift(mapCloudLead(row));save();}else{state.leads.unshift({id:'l'+Date.now(),...input,status:'Uncontacted',websiteQuality:input.website?'Website':'No website',rating:null,reviews:0,nextFollowUp:'',lastContacted:'',contact:'',createdAt:nowIsoLocal(),updatedAt:nowIsoLocal(),activities:[]});save();}closeModal();render();}catch(error){alert(error.message||'Could not add the lead.');}};
    const sf=document.querySelector('[data-save-followup]');if(sf)sf.onclick=async()=>{const l=leadById(sf.dataset.saveFollowup);const when=el('mFollow').value;try{await patchLead(l.id,{nextFollowUp:when,status:'Follow Up'});closeModal();}catch(error){alert(error.message||'Could not save follow-up.');}};
    const ce=document.querySelector('[data-copy-email]');if(ce)ce.onclick=async()=>{await navigator.clipboard.writeText(`To: ${el('mEmailTo').value}\nSubject: ${el('mEmailSubject').value}\n\n${el('mEmailBody').value}`);const l=leadById(ce.dataset.copyEmail);logEvent(l,'email','Follow-up email copied');alert('Email copied.');closeModal();renderDrawer()};
    const cm=document.querySelector('[data-copy-message]');if(cm)cm.onclick=async()=>{const body=el('mMessageBody').value;try{await navigator.clipboard.writeText(body);cm.textContent='Copied';}catch{alert('Could not copy automatically. Select the message text and copy it manually.');}};
    const om=document.querySelector('[data-open-message]');if(om)om.onclick=()=>{const l=leadById(om.dataset.openMessage);const body=el('mMessageBody').value.trim();if(!l||!body)return;if(!String(outreachMessageSettings.website||'').trim()&&body.includes('check out the FirstSeen Digital website')){if(!confirm('Your website address is not set in FirstSeen yet. Open Messages anyway?'))return;}location.href=smsHref(l.phone,body);};
    const qc=document.querySelector('[data-quick-call]');if(qc)qc.onclick=()=>{const id=el('mQuickLead')?.value;if(!id)return;closeModal();startCall(id)};
    const copyT=document.querySelector('[data-copy-twiml]');if(copyT)copyT.onclick=async()=>{await navigator.clipboard.writeText(el('twTemplate').value);copyT.textContent='Copied';};
    const saveTw=document.querySelector('[data-twilio-save]');if(saveTw)saveTw.onclick=async()=>{
      const payload={accountSid:el('twAccountSid').value.trim(),apiKeySid:el('twApiKeySid').value.trim(),apiKeySecret:el('twApiKeySecret').value.trim(),twimlAppSid:el('twAppSid').value.trim(),callerId:el('twCallerId').value.trim(),identity:el('twIdentity').value.trim(),countryCode:el('twCountry').value.trim(),edge:el('twEdge').value,voiceUrl:el('twVoiceUrl').value.trim()};
      const st=el('twSetupStatus');try{saveTw.disabled=true;st.textContent='Saving securely…';const result=await api('/api/twilio/config',{method:'POST',body:JSON.stringify(payload)});st.textContent=result.configured?'Saved. Twilio credentials are complete.':'Saved. Some required fields are still missing.';await refreshIntegrationStatus();render();}
      catch(error){st.textContent=error.message||'Could not save Twilio settings.';}finally{saveTw.disabled=false;}
    };
    const boot=document.querySelector('[data-twilio-bootstrap]');if(boot)boot.onclick=async()=>{
      const payload={accountSid:el('twAccountSid').value.trim(),apiKeySid:el('twApiKeySid').value.trim(),apiKeySecret:el('twApiKeySecret').value.trim(),twimlAppSid:el('twAppSid').value.trim(),callerId:el('twCallerId').value.trim(),identity:el('twIdentity').value.trim(),countryCode:el('twCountry').value.trim(),edge:el('twEdge').value,voiceUrl:el('twVoiceUrl').value.trim()};
      const st=el('twSetupStatus');try{boot.disabled=true;st.textContent='Saving and configuring Twilio…';const result=await api('/api/twilio/bootstrap',{method:'POST',body:JSON.stringify(payload)});if(result.twimlAppSid)el('twAppSid').value=result.twimlAppSid;st.textContent=`Connected${result.appName?` to ${result.appName}`:''}. Browser calling is ready.`;await refreshIntegrationStatus();connection.twilio=true;state.settings.twilio=true;render();}
      catch(error){st.textContent=error.message||'Could not configure Twilio.';}finally{boot.disabled=false;}
    };
    const clearTw=document.querySelector('[data-twilio-clear]');if(clearTw)clearTw.onclick=async()=>{if(!confirm('Disconnect Twilio Browser Calling from this computer?'))return;try{await api('/api/twilio/config',{method:'DELETE'});if(voice.device){try{voice.device.destroy();}catch{}}voice.device=null;connection.twilio=false;state.settings.twilio=false;closeModal();render();}catch(error){alert(error.message||'Could not disconnect Twilio.');}};
  }

  el('searchInput').addEventListener('input',()=>{if(['leads','wantcontact','pipeline','callqueue'].includes(activeView))render()});
  el('startCallingBtn').onclick=()=>{activeView='callqueue';callLeadId=null;render()};
  el('quickCallBtn').onclick=quickCallModal;
  el('addLeadBtn').onclick=addLeadModal;
  el('settingsBtn').onclick=()=>{activeView='settings';render()};
  el('drawerBackdrop').onclick=closeDrawer;el('modalBackdrop').onclick=closeModal;
  render();
  refreshDesktopData({quiet:true}).then(async()=>{await refreshIntegrationStatus();await refreshOutreachMessageSettings();await refreshCloudConnection({fetchLeads:true});if(cloud.signedIn)await fullCloudSync({quiet:true});scheduleCloudSync();render();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&cloud.signedIn)fullCloudSync({quiet:true}).then(()=>render());});
})();
