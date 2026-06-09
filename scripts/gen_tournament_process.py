#!/usr/bin/env python3
"""Generate n8n/tournament-process.json. Firecrawl-rendered (JS/Cloudflare tournament sites)
two-stage: render homepage -> find participants link -> render participants page -> LLM extract."""
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

FINDPART_JS = r"""
const ps=$('Pick site').first().json;
let data={}; try{ data=($('Firecrawl Home').first().json||{}).data||{}; }catch(e){}
const homeMd=String(data.markdown||'');
const links=Array.isArray(data.links)?data.links:[];
const hostOf=(u)=>String(u||'').replace(/^https?:\/\//i,'').replace(/^www\./i,'').split(/[\/?#]/)[0].toLowerCase();
const PART=/(teams?|participant|participating|squadre|squadra|mannschaft|equipe|equipos|deelnemers|druzyn|clubs?|rooms?|draw|bracket|groups?|standings|classifica|tabella|entry|entries|startlist|iscritte|omades|komandos|lag)/i;
let cand=[].concat(ps.cands||[]);
for(const l of links){ if(typeof l==='string' && PART.test(l)) cand.push(l); }
// also pull markdown links [text](url) whose text/url matches
let m; const reMd=/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
while((m=reMd.exec(homeMd))){ if(PART.test(m[1])||PART.test(m[2])) cand.push(m[2]); }
const seen=new Set(); const ordered=[];
for(const u of cand){ if(typeof u!=='string'||!/^https?:/i.test(u))continue; const k=u.split('#')[0]; if(seen.has(k))continue; seen.add(k); ordered.push(k); }
// prefer same-host candidates first
ordered.sort((a,b)=>(hostOf(a)===ps.host?0:1)-(hostOf(b)===ps.host?0:1));
const participantsUrl=ordered[0]||ps.site;
return [{json:Object.assign({},ps,{homeMd:homeMd.slice(0,4000),participantsUrl})}];
"""

BUNDLE_JS = r"""
const fp=$('Find participants').first().json;
let pd={}; try{ pd=($('Firecrawl Participants').first().json||{}).data||{}; }catch(e){}
const partMd=String(pd.markdown||'');
const hostOf=(u)=>String(u||'').replace(/^https?:\/\//i,'').replace(/^www\./i,'').split(/[\/?#]/)[0].toLowerCase();
const bundle=[];
if(partMd) bundle.push({url:fp.participantsUrl,text:partMd.slice(0,13000)});
if(fp.homeMd && hostOf(fp.participantsUrl)!==hostOf(fp.site)) bundle.push({url:fp.site,text:String(fp.homeMd).slice(0,2500)});
if(!bundle.length && fp.homeMd) bundle.push({url:fp.site,text:String(fp.homeMd).slice(0,8000)});
const ph=hostOf(fp.participantsUrl);
const platform=/dataproject/.test(ph)?'dataproject':/challonge/.test(ph)?'challonge':/sportsengine|sportngin/.test(ph)?'sportsengine':/tourneymachine|advancedeventsystems|aes/.test(ph)?'aes':'';
return [{json:{kwId:fp.kwId,keyword:fp.keyword,country:fp.country,resultsCount:fp.resultsCount,site:fp.site,participantsUrl:fp.participantsUrl,platform,bundle}}];
"""

CREATE_JS = r"""
const PB_URL=($('Config').first().json.pbUrl||'').replace(/\/+$/,'');
const token=$('PB Auth').first().json.token; const pbH={Authorization:token};
const c=$('Bundle').first().json;
const uslug=(s)=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80);
let out={}; try{ const resp=$('Extract').first().json; const txt=(resp&&resp.content&&resp.content[0]&&resp.content[0].text)||''; out=JSON.parse(String(txt).replace(/```json/gi,'').replace(/```/g,'').trim()); }catch(e){ out={}; }
const teams=Array.isArray(out.teams)?out.teams:[];
const COUNTRIES=new Set(['afghanistan','albania','algeria','andorra','argentina','armenia','australia','austria','azerbaijan','bahrain','belarus','belgium','bosnia','bosnia and herzegovina','brazil','bulgaria','canada','chile','china','colombia','croatia','cuba','cyprus','czechia','czech republic','denmark','dominican republic','egypt','england','estonia','finland','france','georgia','germany','greece','hungary','iceland','india','iran','iraq','ireland','israel','italy','japan','kazakhstan','kosovo','latvia','lithuania','luxembourg','malta','mexico','moldova','monaco','montenegro','morocco','netherlands','north macedonia','norway','poland','portugal','puerto rico','qatar','romania','russia','san marino','serbia','slovakia','slovenia','south korea','korea','spain','sweden','switzerland','thailand','tunisia','turkey','turkiye','ukraine','united states','usa','uruguay','wales','scotland']);
const isCountry=(n)=>{const t=String(n||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\b(national team|nationalteam|u-?\d+|men|women|w|m)\b/g,'').replace(/[^a-z ]/g,'').trim(); return COUNTRIES.has(t);};
const keyEsc=String(c.keyword).replace(/"/g,'');
let tour=null; try{ const r=await this.helpers.httpRequest({method:'GET',url:PB_URL+'/api/collections/tournaments/records',qs:{filter:'keyword="'+keyEsc+'"',perPage:1},headers:pbH,json:true}); tour=(r.items&&r.items[0])||null; }catch(e){}
const tbody={name:String(out.tournament_title||c.keyword).slice(0,200),keyword:c.keyword,country:c.country||'',website_url:c.site||'',participants_url:out.participants_url||c.participantsUrl||'',platform:String(out.platform||c.platform||'').slice(0,60),source:'google',results_count:c.resultsCount||0,participants_count:teams.length,last_run:new Date().toISOString()};
let tid='';
if(tour){ tid=tour.id; }
else { try{ const cr=await this.helpers.httpRequest({method:'POST',url:PB_URL+'/api/collections/tournaments/records',headers:pbH,body:Object.assign({},tbody,{status:'found'}),json:true}); tid=cr.id; }catch(e){ try{ const r=await this.helpers.httpRequest({method:'GET',url:PB_URL+'/api/collections/tournaments/records',qs:{filter:'keyword="'+keyEsc+'"',perPage:1},headers:pbH,json:true}); tid=(r.items&&r.items[0]&&r.items[0].id)||''; }catch(_){} } }
let created=0,dup=0,kept=0; const newIds=[];
for(const t of teams){ const name=String((t&&t.name)||'').trim(); if(!name)continue; if(t.is_club===false||isCountry(name))continue; kept++;
  const dk='tournament:'+tid+':'+uslug(name);
  const club={tournament:tid,name:name.slice(0,200),country:String(t.country||c.country||'').slice(0,80),city:String(t.city||'').slice(0,100),website_url:(/^https?:\/\//i.test(t.website||'')?t.website:''),website_source:'tournament',status:'needs_review',dedup_key:dk,notes:'Tournament discovery: '+String(out.tournament_title||c.keyword).slice(0,120)};
  try{ const cr=await this.helpers.httpRequest({method:'POST',url:PB_URL+'/api/collections/clubs/records',headers:pbH,body:club,json:true}); created++; newIds.push(cr.id); }catch(e){ dup++; }
}
if(newIds.length){ try{ await this.helpers.httpRequest({method:'POST',url:'https://n8n-2.biceps.digital/webhook/batch-enrich',headers:{'Content-Type':'application/json'},body:{ids:newIds,force:false},json:true,timeout:15000}); }catch(e){}
  try{ await this.helpers.httpRequest({method:'POST',url:'https://n8n-2.biceps.digital/webhook/scrape-enqueue',headers:{'Content-Type':'application/json'},body:{ids:newIds},json:true,timeout:15000}); }catch(e){} }
if(tid){ const st=teams.length?'extracted':(out.is_tournament?'no_participants':'needs_review'); try{ await this.helpers.httpRequest({method:'PATCH',url:PB_URL+'/api/collections/tournaments/records/'+tid,headers:pbH,body:Object.assign({},tbody,{status:st,clubs_found:created}),json:true}); }catch(e){} }
try{ await this.helpers.httpRequest({method:'PATCH',url:PB_URL+'/api/collections/search_keywords/records/'+c.kwId,headers:pbH,body:{status:'searched',searched_at:new Date().toISOString(),results_count:c.resultsCount||0,accepted_count:kept,new_clubs:created,dup_count:dup},json:true}); }catch(e){}
return [{json:{kwId:c.kwId,tournament:tid,site:c.site,participantsUrl:c.participantsUrl,participants:teams.length,kept,created,dup}}];
"""

EXTRACT_BODY = (
  "={{ JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 3500, messages: [ { role: 'user', "
  "content: 'You are extracting the PARTICIPATING CLUBS/TEAMS of a volleyball tournament from rendered web pages. "
  "Tournament search keyword: ' + JSON.stringify($json.keyword) + '. Pages (url + content): ' + "
  "JSON.stringify($json.bundle) + '. Find the list of participating teams. Respond ONLY with compact JSON "
  "{\\\"is_tournament\\\":true,\\\"tournament_title\\\":\\\"\\\",\\\"participants_url\\\":\\\"\\\",\\\"platform\\\":\\\"\\\","
  "\\\"teams\\\":[{\\\"name\\\":\\\"\\\",\\\"city\\\":\\\"\\\",\\\"country\\\":\\\"\\\",\\\"website\\\":\\\"\\\",\\\"is_club\\\":true}]}. "
  "Rules: is_tournament=true only if these pages are a real volleyball tournament/event (not a federation homepage, a news article, or a shop). "
  "teams = each participating team/club exactly as listed; set is_club=false when the entry is a NATIONAL TEAM, a country name, or an all-star/select squad "
  "(e.g. \\\"Germany\\\", \\\"Team USA\\\", \\\"Poland U21 National Team\\\"); website = the club own site if linked on the page, else \\\"\\\". "
  "If you cannot find a participant list, return teams:[]. platform = the site/software if obvious (dataproject, challonge, sportsengine, custom). "
  "No prose, no code fences.' } ] }) }}"
)

def fc_body(url_expr):
    return ("={{ JSON.stringify({ url: " + url_expr +
            ", formats: ['markdown','links'], onlyMainContent: false, waitFor: 2500, timeout: 60000 }) }}")

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
    node("fp","Find participants","n8n-nodes-base.code",[140,0],
         {"mode":"runOnceForAllItems","language":"javaScript","jsCode":FINDPART_JS.strip()+"\n"},2),
    node("fcp","Firecrawl Participants","n8n-nodes-base.httpRequest",[300,0],
         {"method":"POST","url":"https://api.firecrawl.dev/v1/scrape","authentication":"genericCredentialType","genericAuthType":"httpHeaderAuth","sendBody":True,"specifyBody":"json","jsonBody":fc_body("$('Find participants').item.json.participantsUrl"),"options":{"timeout":70000}},4.2,{"onError":"continueRegularOutput","credentials":FIRECRAWL_CRED}),
    node("bun","Bundle","n8n-nodes-base.code",[460,0],
         {"mode":"runOnceForAllItems","language":"javaScript","jsCode":BUNDLE_JS.strip()+"\n"},2),
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
        "Firecrawl Home": {"main":[[{"node":"Find participants","type":"main","index":0}]]},
        "Find participants": {"main":[[{"node":"Firecrawl Participants","type":"main","index":0}]]},
        "Firecrawl Participants": {"main":[[{"node":"Bundle","type":"main","index":0}]]},
        "Bundle": {"main":[[{"node":"Extract","type":"main","index":0}]]},
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
