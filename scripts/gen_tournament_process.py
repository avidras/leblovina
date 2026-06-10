#!/usr/bin/env python3
"""Generate n8n/tournament-process.json.

v2 (multi-page roster extraction). Firecrawl-rendered tournament sites:
  render homepage -> PLAN ranked participant pages (path-scored, root rejected, DataProject
  CompetitionTeamSearch URLs built, capped at 8) -> Firecrawl + LLM extract EACH page
  (HTTP nodes map over the N planned pages) -> Create unions + dedupes teams, makes clubs.
See specs/tournament-led-discovery.md (v2 note)."""
import json, os

PICK_JS = r"""
const kw=$('Get Keyword').first().json;
const organic=(($('Serper Search').first().json||{}).organic)||[];
const hostOf=(u)=>String(u||'').replace(/^https?:\/\//i,'').replace(/^www\./i,'').split(/[\/?#]/)[0].toLowerCase();
const blocked=/(facebook|instagram|twitter|x\.com|youtube|tiktok|wikipedia|fandom|pinterest|reddit)/i;
const PART=/(teams?|participant|participating|squadre|squadra|mannschaft|equipe|equipos|deelnemers|druzyn|clubs?|rooms?|draw|bracket|groups?|standings|classifica|tabella|entry|entries|startlist|iscritte|omades|komandos|lag)/i;
const orgs=organic.filter(r=>r.link&&/^https?:/i.test(r.link)&&!blocked.test(hostOf(r.link)));
const site=(orgs[0]&&orgs[0].link)||'';
const cands=orgs.filter(r=>PART.test(r.link||'')||PART.test(r.title||'')||PART.test(r.snippet||'')).map(r=>r.link);
return [{json:{kwId:kw.id,keyword:kw.keyword,country:kw.country||'',resultsCount:organic.length,site:site||'https://example.invalid',host:hostOf(site),cands}}];
"""

# Plan up to 8 participant pages. Score by the URL's LAST PATH SEGMENT (not Serper rank or
# snippet): strong team-list basenames win; player/news/standings/etc and root URLs are dropped.
# DataProject competition links are turned into canonical CompetitionTeamSearch.aspx?ID=<n> URLs.
PLAN_JS = r"""
const ps=$('Pick site').first().json;
let data={}; try{ data=($('Firecrawl Home').first().json||{}).data||{}; }catch(e){}
const homeMd=String(data.markdown||'');
const links=Array.isArray(data.links)?data.links.filter(x=>typeof x==='string'):[];
const hostOf=(u)=>String(u||'').replace(/^https?:\/\//i,'').replace(/^www\./i,'').split(/[\/?#]/)[0].toLowerCase();
const pathOf=(u)=>String(u||'').replace(/^https?:\/\/[^\/]*/i,'').split(/[?#]/)[0].replace(/\/+$/,'');
const baseOf=(u)=>{const p=pathOf(u);return (p.split('/').pop()||'').toLowerCase();};
const STRONG=/(mannschaft|teamsearch|team-?search|^teams?$|^teams?\.|squadr|equipos?|equipes?|deelnemers|participant|vereine|verein|druzyn|iscritte|startlist|ekipe|omades|komandos|roster|members|clubs?)/;
const BAD=/(spieler|player|mvp|news|presse|tabelle|standing|spielplan|spielmodus|halle|wechsel|archiv|statistik|ranking|history|matches|privacy|cookie|login|kontakt|impressum|datenschutz|ticket|shop|stream|video|partner|jobs)/;
// collect candidate urls: home links + markdown links + serper cands
let urls=[].concat(links,(ps.cands||[]));
let m; const reMd=/\]\((https?:\/\/[^)]+)\)/g; while((m=reMd.exec(homeMd))) urls.push(m[1]);
// DataProject: build CompetitionTeamSearch.aspx?ID=<n> per distinct (host,competition id)
const dpSeen=new Set(); const dpPages=[];
for(const u of urls){ const mm=String(u).match(/^(https?:\/\/[^\/]*dataproject\.com)\/Competition[^?]*\.aspx\?[^#]*\bID=(\d+)/i); if(mm){ const k=mm[1].toLowerCase()+'|'+mm[2]; if(!dpSeen.has(k)){ dpSeen.add(k); dpPages.push(mm[1]+'/CompetitionTeamSearch.aspx?ID='+mm[2]); } } }
// generic team-list pages, scored by basename
const seen=new Set(); const scored=[];
for(const u of urls){ if(typeof u!=='string'||!/^https?:/i.test(u))continue; const k=u.split('#')[0]; if(seen.has(k))continue; seen.add(k);
  const p=pathOf(u); if(!p||p==='/')continue; // reject root/homepage
  const b=baseOf(u); if(!b||BAD.test(b)||!STRONG.test(b))continue;
  const sameHost=hostOf(u)===ps.host?2:0; const bonus=(b.indexOf('mannschaft')>=0||b.indexOf('teamsearch')>=0||/^teams?(\.|$)/.test(b))?1:0;
  scored.push({url:k,score:sameHost+bonus}); }
scored.sort((a,b)=>b.score-a.score);
let pages=dpPages.concat(scored.map(s=>s.url));
const fseen=new Set(); pages=pages.filter(u=>{const k=u.split('#')[0]; if(fseen.has(k))return false; fseen.add(k); return true;}).slice(0,8);
const platform=dpPages.length?'dataproject':((pages[0]&&/challonge/.test(hostOf(pages[0])))?'challonge':((pages[0]&&/sportsengine|sportngin/.test(hostOf(pages[0])))?'sportsengine':''));
if(!pages.length) pages=[ps.site]; // fallback: homepage (LLM will return no teams -> no_participants)
return pages.map((u,i)=>({json:{kwId:ps.kwId,keyword:ps.keyword,country:ps.country,resultsCount:ps.resultsCount,site:ps.site,host:ps.host,platform,participantsUrl:pages[0],pageUrl:u,idx:i,total:pages.length}}));
"""

# Per page: pull the rendered markdown, drop the leading nav block by starting at the first
# top-level H1 (team lists sit below a big menu on portals like VBL), cap at 45k chars.
TRIM_JS = r"""
const plans=$('Plan pages').all();
const out=[];
for(let i=0;i<items.length;i++){
  let md=''; try{ md=String((((items[i].json||{}).data)||{}).markdown||''); }catch(e){}
  const h=md.search(/\n#\s+\S/);
  if(h>800) md=md.slice(h);
  md=md.slice(0,45000);
  const meta=(plans[i]&&plans[i].json)||(plans[0]&&plans[0].json)||{};
  out.push({json:{text:md,keyword:meta.keyword||'',country:meta.country||'',pageUrl:meta.pageUrl||'',platform:meta.platform||''}});
}
return out;
"""

# Reads ALL per-page LLM responses, unions + dedupes teams (by uslug), filters non-clubs, creates.
CREATE_JS = r"""
const PB_URL=($('Config').first().json.pbUrl||'').replace(/\/+$/,'');
const token=$('PB Auth').first().json.token; const pbH={Authorization:token};
const meta=($('Plan pages').first().json)||{};
const gk=$('Get Keyword').first().json||{};
const keyword=gk.keyword||meta.keyword||'';
const country=gk.country||meta.country||'';
const site=(($('Pick site').first().json||{}).site)||'';
const uslug=(s)=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80);
let resp=[]; try{ resp=$('Extract').all(); }catch(e){ resp=[]; }
let title=''; let anyTour=false; const teams=[]; const tseen=new Set();
for(const it of resp){ let out={}; try{ const txt=((((it.json||{}).content)||[])[0]||{}).text||''; out=JSON.parse(String(txt).replace(/```json/gi,'').replace(/```/g,'').trim()); }catch(e){ out={}; }
  if(out&&out.is_tournament) anyTour=true; if(!title&&out&&out.tournament_title) title=out.tournament_title;
  const arr=Array.isArray(out.teams)?out.teams:[];
  for(const t of arr){ const nm=String((t&&t.name)||'').trim(); if(!nm)continue; const k=uslug(nm); if(!k||tseen.has(k))continue; tseen.add(k); teams.push(t); }
}
const COUNTRIES=new Set(['afghanistan','albania','algeria','andorra','argentina','armenia','australia','austria','azerbaijan','bahrain','belarus','belgium','bosnia','bosnia and herzegovina','brazil','bulgaria','canada','chile','china','colombia','croatia','cuba','cyprus','czechia','czech republic','denmark','dominican republic','egypt','england','estonia','finland','france','georgia','germany','greece','hungary','iceland','india','iran','iraq','ireland','israel','italy','japan','kazakhstan','kosovo','latvia','lithuania','luxembourg','malta','mexico','moldova','monaco','montenegro','morocco','netherlands','north macedonia','norway','poland','portugal','puerto rico','qatar','romania','russia','san marino','serbia','slovakia','slovenia','south korea','korea','spain','sweden','switzerland','thailand','tunisia','turkey','turkiye','ukraine','united states','usa','uruguay','wales','scotland']);
const isCountry=(n)=>{const t=String(n||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\b(national team|nationalteam|u-?\d+|men|women|w|m)\b/g,'').replace(/[^a-z ]/g,'').trim(); return COUNTRIES.has(t);};
const keyEsc=String(keyword).replace(/"/g,'');
let tour=null; try{ const r=await this.helpers.httpRequest({method:'GET',url:PB_URL+'/api/collections/tournaments/records',qs:{filter:'keyword="'+keyEsc+'"',perPage:1},headers:pbH,json:true}); tour=(r.items&&r.items[0])||null; }catch(e){}
const tbody={name:String(keyword||title).slice(0,200),keyword:keyword,country:country||'',website_url:site||'',participants_url:meta.participantsUrl||'',platform:String(meta.platform||'').slice(0,60),source:'google',results_count:meta.resultsCount||0,participants_count:teams.length,last_run:new Date().toISOString()};
let tid='';
if(tour){ tid=tour.id; }
else { try{ const cr=await this.helpers.httpRequest({method:'POST',url:PB_URL+'/api/collections/tournaments/records',headers:pbH,body:Object.assign({},tbody,{status:'found'}),json:true}); tid=cr.id; }catch(e){ try{ const r=await this.helpers.httpRequest({method:'GET',url:PB_URL+'/api/collections/tournaments/records',qs:{filter:'keyword="'+keyEsc+'"',perPage:1},headers:pbH,json:true}); tid=(r.items&&r.items[0]&&r.items[0].id)||''; }catch(_){} } }
// keep surviving clubs (drop national teams / country names / select squads)
const kept0=[]; for(const t of teams){ const name=String((t&&t.name)||'').trim(); if(!name)continue; if(t.is_club===false||isCountry(name))continue; kept0.push(t); }
// creation-time dedup guard: normalized name + same country (see specs/tournament-led-discovery.md v2.1)
const norm=(s)=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
const existing={}; // country -> Map(normName -> {id,website_url})
const countries=Array.from(new Set(kept0.map(t=>String(t.country||country||'').trim()).filter(Boolean)));
for(const co of countries){ const map=new Map(); let p=1;
  while(true){ let r; try{ r=await this.helpers.httpRequest({method:'GET',url:PB_URL+'/api/collections/clubs/records',qs:{filter:'country="'+String(co).replace(/"/g,'')+'"',perPage:200,page:p,fields:'id,name,website_url'},headers:pbH,json:true}); }catch(e){ break; }
    for(const it of (r.items||[])){ const k=norm(it.name); if(k&&!map.has(k)) map.set(k,it); }
    if(!r.totalPages||p>=r.totalPages||p>=30) break; p++; }
  existing[co]=map; }
let created=0,dup=0,merged=0; const kept=kept0.length; const newIds=[];
for(const t of kept0){ const name=String(t.name).trim(); const co=String(t.country||country||'').trim();
  const tw=(/^https?:\/\//i.test(t.website||'')?t.website:'');
  const map=existing[co]; const hit=map?map.get(norm(name)):null;
  if(hit){ dup++; merged++; // enrich existing, keep its route: backfill website_url only if missing
    if(tw && !hit.website_url){ try{ await this.helpers.httpRequest({method:'PATCH',url:PB_URL+'/api/collections/clubs/records/'+hit.id,headers:pbH,body:{website_url:tw},json:true}); hit.website_url=tw; }catch(e){} }
    continue; }
  const dk='tournament:'+tid+':'+uslug(name);
  const club={tournament:tid,name:name.slice(0,200),country:String(co).slice(0,80),city:String(t.city||'').slice(0,100),website_url:tw,website_source:'tournament',status:'needs_review',dedup_key:dk,notes:'Tournament discovery: '+String(keyword||title).slice(0,120)};
  try{ const cr=await this.helpers.httpRequest({method:'POST',url:PB_URL+'/api/collections/clubs/records',headers:pbH,body:club,json:true}); created++; newIds.push(cr.id);
    if(co){ const m2=existing[co]||new Map(); m2.set(norm(name),{id:cr.id,website_url:club.website_url}); existing[co]=m2; } }catch(e){ dup++; }
}
if(newIds.length){ try{ await this.helpers.httpRequest({method:'POST',url:'https://n8n-2.biceps.digital/webhook/batch-enrich',headers:{'Content-Type':'application/json'},body:{ids:newIds,force:false},json:true,timeout:15000}); }catch(e){}
  try{ await this.helpers.httpRequest({method:'POST',url:'https://n8n-2.biceps.digital/webhook/scrape-enqueue',headers:{'Content-Type':'application/json'},body:{ids:newIds},json:true,timeout:15000}); }catch(e){} }
if(tid){ const st=kept?'extracted':(anyTour?'no_participants':'needs_review'); try{ await this.helpers.httpRequest({method:'PATCH',url:PB_URL+'/api/collections/tournaments/records/'+tid,headers:pbH,body:Object.assign({},tbody,{status:st,clubs_found:created,notes:'created '+created+', merged-into-existing '+merged+', pages '+resp.length}),json:true}); }catch(e){} }
try{ await this.helpers.httpRequest({method:'PATCH',url:PB_URL+'/api/collections/search_keywords/records/'+meta.kwId,headers:pbH,body:{status:'searched',searched_at:new Date().toISOString(),results_count:meta.resultsCount||0,accepted_count:kept,new_clubs:created,dup_count:dup},json:true}); }catch(e){}
return [{json:{kwId:meta.kwId,tournament:tid,site:site,pages:resp.length,participants:teams.length,kept,created,merged,dup}}];
"""

EXTRACT_BODY = (
  "={{ JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 4000, messages: [ { role: 'user', "
  "content: 'You are extracting the PARTICIPATING CLUBS/TEAMS of a volleyball tournament from ONE rendered web page. "
  "Tournament search keyword: ' + JSON.stringify($json.keyword) + '. Page URL: ' + JSON.stringify($json.pageUrl) + '. "
  "Page content (markdown): ' + JSON.stringify(String($json.text||'')) + '. Find the list of participating teams/clubs on THIS page. "
  "Respond ONLY with compact JSON {\\\"is_tournament\\\":true,\\\"tournament_title\\\":\\\"\\\","
  "\\\"teams\\\":[{\\\"name\\\":\\\"\\\",\\\"city\\\":\\\"\\\",\\\"country\\\":\\\"\\\",\\\"website\\\":\\\"\\\",\\\"is_club\\\":true}]}. "
  "Rules: is_tournament=true only if this is a real volleyball tournament/event page (team list, standings, draw, groups) "
  "and not a federation homepage, a news article, or a shop. teams = each participating team/club exactly as listed on this page; "
  "set is_club=false when the entry is a NATIONAL TEAM, a country name, or an all-star/select squad "
  "(e.g. \\\"Germany\\\", \\\"Team USA\\\", \\\"Poland U21 National Team\\\"). "
  "country = the team country; if a country code or flag is shown next to the team (e.g. \\\"(CRO)\\\", \\\"(HUN)\\\") map it to the country name. "
  "website = the club own external site if linked on the page, else \\\"\\\". "
  "If there is no participant list on this page, return teams:[]. No prose, no code fences.' } ] }) }}"
)

def fc_body(url_expr, formats="['markdown','links']", main="false", wait="2500"):
    return ("={{ JSON.stringify({ url: " + url_expr + ", formats: " + formats +
            ", onlyMainContent: " + main + ", waitFor: " + wait + ", timeout: 60000 }) }}")

def node(id, name, ntype, pos, params, tv=1, extra=None):
    n = {"parameters": params, "id": id, "name": name, "type": ntype, "typeVersion": tv, "position": pos}
    if extra: n.update(extra)
    return n

PB_CRED = {"httpCustomAuth": {"id": "hzdBwrAqrPZjDmME", "name": "PocketBase admin (api)"}}
SERPER_CRED = {"httpHeaderAuth": {"id": "oPmSDcClj5DfGKCM", "name": "Serper (leblovina)"}}
FIRECRAWL_CRED = {"httpHeaderAuth": {"id": "ZxHAcWu5UlNAMy8X", "name": "Firecrawl (leblovina)"}}
ANTHROPIC_CRED = {"anthropicApi": {"id": "PsTv3b7j6pP2jeMt", "name": "Anthropic (leblovina)"}}

nodes = [
    node("wh","Webhook","n8n-nodes-base.webhook",[-980,0],
         {"httpMethod":"POST","path":"tournament-process","responseMode":"lastNode","options":{}},2,{"webhookId":"tournament-process"}),
    node("cfg","Config","n8n-nodes-base.set",[-820,0],
         {"assignments":{"assignments":[{"id":"p","name":"pbUrl","value":"https://leblovina.tools.biceps.digital","type":"string"}]},"options":{}},3.4),
    node("auth","PB Auth","n8n-nodes-base.httpRequest",[-660,0],
         {"method":"POST","url":"={{ $('Config').item.json.pbUrl }}/api/collections/_superusers/auth-with-password","authentication":"genericCredentialType","genericAuthType":"httpCustomAuth","options":{}},4.2,{"credentials":PB_CRED}),
    node("getk","Get Keyword","n8n-nodes-base.httpRequest",[-500,0],
         {"method":"GET","url":"={{ $('Config').item.json.pbUrl }}/api/collections/search_keywords/records/{{ $('Webhook').item.json.body.id }}","sendHeaders":True,"headerParameters":{"parameters":[{"name":"Authorization","value":"={{ $('PB Auth').item.json.token }}"}]},"options":{}},4.2),
    node("serp","Serper Search","n8n-nodes-base.httpRequest",[-340,0],
         {"method":"POST","url":"https://google.serper.dev/search","authentication":"genericCredentialType","genericAuthType":"httpHeaderAuth","sendBody":True,"specifyBody":"json","jsonBody":"={{ JSON.stringify({ q: $('Get Keyword').item.json.keyword, num: 10 }) }}","options":{}},4.2,{"onError":"continueRegularOutput","credentials":SERPER_CRED}),
    node("pick","Pick site","n8n-nodes-base.code",[-180,0],
         {"mode":"runOnceForAllItems","language":"javaScript","jsCode":PICK_JS.strip()+"\n"},2),
    node("fch","Firecrawl Home","n8n-nodes-base.httpRequest",[-20,0],
         {"method":"POST","url":"https://api.firecrawl.dev/v1/scrape","authentication":"genericCredentialType","genericAuthType":"httpHeaderAuth","sendBody":True,"specifyBody":"json","jsonBody":fc_body("$('Pick site').item.json.site"),"options":{"timeout":70000}},4.2,{"onError":"continueRegularOutput","credentials":FIRECRAWL_CRED}),
    node("plan","Plan pages","n8n-nodes-base.code",[140,0],
         {"mode":"runOnceForAllItems","language":"javaScript","jsCode":PLAN_JS.strip()+"\n"},2),
    node("fcp","Firecrawl Participants","n8n-nodes-base.httpRequest",[300,0],
         {"method":"POST","url":"https://api.firecrawl.dev/v1/scrape","authentication":"genericCredentialType","genericAuthType":"httpHeaderAuth","sendBody":True,"specifyBody":"json","jsonBody":fc_body("$json.pageUrl","['markdown']","true","3500"),"options":{"timeout":70000}},4.2,{"onError":"continueRegularOutput","credentials":FIRECRAWL_CRED}),
    node("trim","Trim","n8n-nodes-base.code",[460,0],
         {"mode":"runOnceForAllItems","language":"javaScript","jsCode":TRIM_JS.strip()+"\n"},2),
    node("ext","Extract","n8n-nodes-base.httpRequest",[620,0],
         {"method":"POST","url":"https://api.anthropic.com/v1/messages","authentication":"predefinedCredentialType","nodeCredentialType":"anthropicApi","sendHeaders":True,"headerParameters":{"parameters":[{"name":"anthropic-version","value":"2023-06-01"}]},"sendBody":True,"specifyBody":"json","jsonBody":EXTRACT_BODY,"options":{"timeout":40000}},4.2,{"onError":"continueRegularOutput","credentials":ANTHROPIC_CRED}),
    node("crt","Create","n8n-nodes-base.code",[780,0],
         {"mode":"runOnceForAllItems","language":"javaScript","jsCode":CREATE_JS.strip()+"\n"},2),
]

wf = {
    "name": "Leblovina — Tournament process",
    "nodes": nodes,
    "connections": {
        "Webhook": {"main":[[{"node":"Config","type":"main","index":0}]]},
        "Config": {"main":[[{"node":"PB Auth","type":"main","index":0}]]},
        "PB Auth": {"main":[[{"node":"Get Keyword","type":"main","index":0}]]},
        "Get Keyword": {"main":[[{"node":"Serper Search","type":"main","index":0}]]},
        "Serper Search": {"main":[[{"node":"Pick site","type":"main","index":0}]]},
        "Pick site": {"main":[[{"node":"Firecrawl Home","type":"main","index":0}]]},
        "Firecrawl Home": {"main":[[{"node":"Plan pages","type":"main","index":0}]]},
        "Plan pages": {"main":[[{"node":"Firecrawl Participants","type":"main","index":0}]]},
        "Firecrawl Participants": {"main":[[{"node":"Trim","type":"main","index":0}]]},
        "Trim": {"main":[[{"node":"Extract","type":"main","index":0}]]},
        "Extract": {"main":[[{"node":"Create","type":"main","index":0}]]},
    },
    "settings": {"executionOrder":"v1"},
    "active": False,
    "pinData": {},
    "meta": {"templateId":"leblovina-tournament-process"},
}

out = os.path.join(os.path.dirname(__file__), "..", "n8n", "tournament-process.json")
with open(out, "w") as f:
    json.dump(wf, f, indent=2)
print("wrote", os.path.abspath(out))
json.load(open(out))  # validate
print("valid json; nodes:", len(nodes))
