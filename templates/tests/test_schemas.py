import json, copy, sys
from jsonschema import Draft202012Validator, FormatChecker
import os; T=os.environ.get('TEMPLATES','/home/user/levuvo-software-factory/templates/')
def V(p):
    s=json.load(open(T+p)); Draft202012Validator.check_schema(s); return Draft202012Validator(s, format_checker=FormatChecker())
H='a'*40
ok=0; bad=0
def case(v,inst,expect,name):
    global ok,bad
    errs=list(v.iter_errors(inst)); valid=not errs
    if valid==expect: ok+=1
    else: bad+=1; print("FAIL",name,"expected",expect,[e.message for e in errs][:2])
def mut(base,f):
    x=copy.deepcopy(base); f(x); return x

spec={"feature_id":"F-001","version":1,"status":"draft","baselines":{"prd":3,"architecture":2,"dor":1},
 "user_stories":[{"as_a":"guest","i_want":"to book a table","so_that":"I get a seat","source":"PRD 7"}],
 "requirements":[{"id":"REQ-001-01","ears":"event","text":"When the guest submits the form, the system shall save the booking.","source":"answer q-3",
   "acceptance_criteria":[{"id":"AC-001-01","statement":"A submitted booking appears in the list."},
     {"id":"AC-001-02","gherkin":{"given":["an empty list"],"when":["the guest books"],"then":["one booking is shown"]}}]}],
 "contract":{"format":"openapi-3.1.1","path":"features/F-001/openapi.yaml"},
 "out_of_scope":["payments"],"open_questions":[{"text":"Max party size?","blocking":False}]}
v=V('spec/spec.schema.json')
case(v,spec,True,"spec valid")
case(v,mut(spec,lambda x:x['requirements'][0].update(acceptance_criteria=[])),False,"spec req without AC")
case(v,mut(spec,lambda x:x['requirements'][0]['acceptance_criteria'][0].update(id="AC-1")),False,"spec bad AC id")
case(v,mut(spec,lambda x:x['requirements'][0].update(source="")),False,"spec empty source")
case(v,mut(spec,lambda x:x['requirements'][0]['acceptance_criteria'][0].update(gherkin={"given":["a"],"when":["b"],"then":["c"]})),False,"spec AC both forms")
case(v,mut(spec,lambda x:x['requirements'][0]['acceptance_criteria'][0].pop('statement')),False,"spec AC no form")
case(v,mut(spec,lambda x:x['requirements'][0].update(ears="free")),False,"spec bad ears")
case(v,mut(spec,lambda x:x['contract'].update(path="features/F-001/../../etc")),False,"spec contract traversal")
case(v,mut(spec,lambda x:x.pop('out_of_scope')),False,"spec no out_of_scope")
case(v,mut(spec,lambda x:x['requirements'][0].pop('source')),False,"spec req no source")
case(v,mut(spec,lambda x:x['user_stories'][0].pop('source')),False,"spec story no source")

plan={"feature_id":"F-001","spec_version":1,"tasks":[{"id":"T-01","title":"Booking form","kind":"build","acceptance_criteria":["AC-001-01","AC-001-02"],"done":False},
 {"id":"T-02","title":"Update docs","kind":"docs","acceptance_criteria":[],"done":False}],
 "impact":{"paths":["src/booking/**","tests/booking/**","README.md"],"modules":["web"],"other_features":[]}}
v=V('plan/plan.schema.json')
case(v,plan,True,"plan valid")
case(v,mut(plan,lambda x:x['tasks'][0].update(acceptance_criteria=[])),False,"plan build task no AC")
case(v,mut(plan,lambda x:x['impact'].update(paths=["../other"])),False,"plan traversal")
case(v,mut(plan,lambda x:x['impact'].update(paths=["/etc/passwd"])),False,"plan absolute")
case(v,mut(plan,lambda x:x['tasks'][0].update(kind="refactor")),False,"plan bad kind")

sc={"feature_id":"F-001","spec_version":1,"version":1,"framework":"playwright","tests":[{"id":"HS-001-01","acceptance_criterion":"AC-001-01","file":"f001/booking.spec.ts","title":"AC-001-01 booking appears"}],
 "baseline":{"main_commit":H,"checked_at":"2026-11-21T10:00:00Z","results":[{"test_id":"HS-001-01","status":"failed_assertion"}]}}
v=V('scenarios/scenarios.schema.json')
case(v,sc,True,"scenarios valid")
case(v,mut(sc,lambda x:x['tests'][0].pop('acceptance_criterion')),False,"scenario no AC")
case(v,mut(sc,lambda x:x['tests'][0].update(acceptance_criterion=["AC-001-01"])),False,"scenario AC list")
case(v,mut(sc,lambda x:x.update(tests=[])),False,"scenario empty")
case(v,mut(sc,lambda x:x.pop('version')),False,"scenario no set version")
case(v,mut(sc,lambda x:x['baseline']['results'][0].update(status="red")),False,"baseline bad status")

br={"mode":"feature","feature_id":"F-001","spec_version":1,"summary":"Gäste können jetzt einen Tisch buchen.","summary_language":"de","deviations":[],"assumptions":[],"risks":[],"env_vars":["DATABASE_URL"]}
v=V('build-report/build-report.schema.json')
case(v,br,True,"build report valid")
case(v,mut(br,lambda x:x.pop('deviations')),False,"build report no deviations")
case(v,mut(br,lambda x:x.update(env_vars=["DATABASE_URL=postgres://x"])),False,"build report env value")

gr={"mode":"feature","feature_id":"F-001","commit":H,"main_commit":"b"*40,"tested_tree":"c"*40,"spec_version":1,"scenario_set_version":1,"gate_policy_version":1,"round":1,"created_at":"2026-11-21T10:00:00Z",
 "gates":[{"name":"visible-tests","dod_item":"DOD-1","status":"passed","result_format":"junit-xml"}],
 "acceptance_criteria":[{"id":"AC-001-01","status":"not_checked","message":"no visible test"}]}
v=V('gate-report/gate-report.schema.json')
case(v,gr,True,"gate report valid")
case(v,mut(gr,lambda x:x['gates'][0].update(status="skipped")),False,"gate bad status")
case(v,mut(gr,lambda x:x.pop('spec_version')),False,"gate no spec version")
case(v,mut(gr,lambda x:x.update(commit="abc")),False,"gate short commit")
case(v,mut(gr,lambda x:x.pop('scenario_set_version')),False,"gate no scenario set")

rr={"mode":"feature","scenario_set_version":1,"feature_id":"F-001","commit":H,"spec_version":1,"gate_policy_version":1,"reviewer_run":"run-9","round":1,"summary":"Implements the spec.",
 "findings":[{"id":"RF-01","severity":"important","category":"security","file":"src/booking/api.ts","line":12,"refs":["AC-001-01"],"finding":"Input not length-limited.","evidence":"api.ts:12 passes body.name unchecked."}],
 "dod_items":[{"id":"DOD-7","met":True,"evidence":"README section Booking added."}]}
v=V('review/review-report.schema.json')
case(v,rr,True,"review valid")
case(v,mut(rr,lambda x:x['findings'][0].update(refs=[])),False,"review finding no ref")
case(v,mut(rr,lambda x:x['findings'][0].pop('evidence')),False,"review no evidence")
case(v,mut(rr,lambda x:x['findings'][0].update(severity="critical")),False,"review bad severity")
case(v,mut(rr,lambda x:x.update(verdict="approved")),False,"review self verdict")
case(v,mut(rr,lambda x:x.pop('dod_items')),False,"feature review no dod")
sk=mut(rr,lambda x:[x.pop(k) for k in ('feature_id','spec_version','scenario_set_version')] and x.update(mode="skeleton"))
case(v,sk,True,"skeleton review valid")
case(v,mut(sk,lambda x:x.update(feature_id="F-001")),False,"skeleton with feature")
tc={"mode":"test_check","feature_id":"F-001","spec_version":1,"scenario_set_version":1,"hidden_test":"HS-001-01","commit":H,"gate_policy_version":1,"reviewer_run":"run-10","round":1,
 "findings":[{"id":"RF-01","severity":"blocking","category":"hidden-scenario","file":"f001/booking.spec.ts","refs":["AC-001-01"],"finding":"Test demands an exact message text the AC does not state.","evidence":"AC-001-01 only requires the booking to appear."}]}
case(v,tc,True,"test check valid")
case(v,mut(tc,lambda x:x['findings'][0].update(category="security")),False,"test check wrong category")
case(v,mut(tc,lambda x:x.update(dod_items=[])),False,"test check with dod")
case(v,mut(tc,lambda x:x.pop('hidden_test')),False,"test check no test")

fe=json.load(open(T+'features/features.schema.json'))
v=V('features/features.schema.json')
f={"prd_version":1,"next_id":2,"features":[{"id":"F-001","name":"Booking","summary":"Book a table.","priority":"must","depends_on":[],"scope_ref":"Bookings","status":"in_progress","spec_version":1}]}
case(v,f,True,"features B status")
case(v,mut(f,lambda x:x['features'][0].update(status="building")),False,"features bad status")

# ---- part C ----
H64='c'*64
rep={"id":"BUG-001","title":"Booking for today is rejected","status":"triage","reported_at":"2026-11-21T10:00:00Z",
 "original_message":{"text":"Ich kann für heute nicht buchen.","language":"de","sha256":H64},
 "attachments":["bugs/BUG-001/attachments/screen.png"],
 "steps_to_reproduce":["Open booking","Pick today","Submit"],"expected":"Booking saved (AC-001-02)","actual":"Error: date in the past",
 "environment":{"version":"1.2.0","device":"iPhone","browser":"Safari"},
 "affected":{"feature_id":"F-001","spec_version":2,"acceptance_criteria":["AC-001-02"],"modules":["web"],"paths":["src/booking/date.ts","tests/booking/**"]},
 "reproduction":{"result":"reproduced","main_commit":H,"evidence":"Submitted today's date, got 400."},
 "proposal":{"category":"bug","reason":"AC-001-02 allows bookings for today."}}
v=V('bugs/report.schema.json')
case(v,rep,True,"report bug valid")
case(v,mut(rep,lambda x:x['affected'].update(acceptance_criteria=[])),False,"bug without AC (GC1.3)")
case(v,mut(rep,lambda x:x['affected'].pop('feature_id')),False,"bug without feature")
case(v,mut(rep,lambda x:x['reproduction'].update(result="not_reproduced")),False,"bug not reproduced")
case(v,mut(rep,lambda x:x.pop('reproduction')),False,"bug no reproduction")
case(v,mut(rep,lambda x:x['proposal'].update(category="question")),False,"fourth category")
case(v,mut(rep,lambda x:x['proposal'].update(spec_delta=[{"op":"modify","target":"AC-001-02","text":"x"}])),False,"bug with delta")
case(v,mut(rep,lambda x:x.pop('original_message')),False,"no original message")
case(v,mut(rep,lambda x:x['original_message'].pop('sha256')),False,"original without hash")
case(v,mut(rep,lambda x:x.update(attachments=["bugs/BUG-001/attachments/../../src/x"])),False,"attachment traversal")
case(v,mut(rep,lambda x:x.update(attachments=["briefing/x.png"])),False,"attachment outside report")
case(v,mut(rep,lambda x:x['affected'].update(paths=["../x"])),False,"affected traversal")
case(v,mut(rep,lambda x:x.update(id="BUG-1")),False,"bad id")
case(v,mut(rep,lambda x:x.update(status="decided")),False,"decided without decision")
dec=mut(rep,lambda x:x.update(status="in_progress",decision={"category":"bug","decided_at":"2026-11-21T10:30:00Z"},fix={"branch":"fix/BUG-001","lesson":"LL-001"}))
case(v,dec,True,"report in progress valid")
ch=mut(rep,lambda x:x.update(proposal={"category":"change","reason":"Works as specified; human wants 30-min slots.","spec_delta":[{"op":"modify","target":"AC-001-03","text":"Slots are 30 minutes long."}]},reproduction={"result":"works_as_specified","main_commit":H,"evidence":"60-min slots per AC-001-03."}))
case(v,ch,True,"report change valid")
case(v,mut(ch,lambda x:x['proposal'].pop('spec_delta')),False,"change without delta")
case(v,mut(ch,lambda x:x['proposal']['spec_delta'][0].update(target="F-001")),False,"delta bad target")
case(v,mut(ch,lambda x:x['affected'].pop('spec_version')),False,"change without spec version")
nr={"id":"BUG-002","title":"App slow","status":"triage","reported_at":"2026-11-21T10:00:00Z","original_message":{"text":"langsam","language":"de","sha256":H64},"attachments":[],
 "reproduction":{"result":"not_reproduced","main_commit":H,"evidence":"Page loads in 300 ms."}}
case(v,nr,True,"not reproduced, no proposal")
dup=mut(nr,lambda x:x.update(status="closed",duplicate_of="BUG-001",closed_reason="duplicate"))
case(v,dup,True,"duplicate closed")
case(v,mut(dup,lambda x:x.update(closed_reason="closed_by_human")),False,"duplicate wrong reason")
case(v,mut(dup,lambda x:x.pop('closed_reason')),False,"closed without reason")
nf=mut(nr,lambda x:x.update(proposal={"category":"new_feature","reason":"Export is a new capability."}))
case(v,nf,True,"new feature proposal")

ll={"lessons":[{"id":"LL-001","date":"2026-11-21","source":"BUG-001","title":"Compare dates in the user's time zone","cause":"Date compared in UTC.","fix":"Compare in the venue time zone.","prevention":"Always convert to the venue time zone before comparing dates.","paths":["src/booking/**"],"modules":["web"],"status":"active"},
 {"id":"LL-004","date":"2026-11-25","source":"BUG-009","title":"Time zone again","cause":"UTC compare.","fix":"Venue zone.","prevention":"Use the shared date helper.","paths":["src/slots/**"],"modules":["web"],"same_as":["LL-001"],"status":"promoted","promoted_to":{"kind":"lint_rule","ref":"no-raw-date-compare, PR 42"}}]}
v=V('lessons-learned/lessons-learned.schema.json')
case(v,ll,True,"lessons valid")
case(v,mut(ll,lambda x:x['lessons'][0].pop('prevention')),False,"lesson no prevention")
case(v,mut(ll,lambda x:x['lessons'][0].update(paths=[])),False,"lesson no paths")
case(v,mut(ll,lambda x:x['lessons'][1].pop('promoted_to')),False,"promoted without check")
case(v,mut(ll,lambda x:x['lessons'][0].update(promoted_to={"kind":"test","ref":"x"})),False,"active with promoted_to")
case(v,mut(ll,lambda x:x['lessons'][0].update(source="F-001")),False,"lesson source not a bug")
case(v,mut(ll,lambda x:x['lessons'][1]['promoted_to'].update(kind="wiki")),False,"bad promotion kind")

v=V('build-report/build-report.schema.json')
case(v,dict(br,report_id="BUG-001"),True,"build report bug mode")
case(v,dict(br,report_id="7"),False,"build report bad report id")
v=V('gate-report/gate-report.schema.json')
case(v,dict(gr,report_id="BUG-001"),True,"gate report bug")
v=V('review/review-report.schema.json')
case(v,mut(rr,lambda x:x.update(report_id="BUG-001") or x['findings'][0].update(category="lesson",refs=["LL-001","BUG-001"])),True,"review lesson finding")
case(v,mut(rr,lambda x:x['findings'][0].update(refs=["LL-1"])),False,"review bad lesson ref")
v=V('scenarios/scenarios.schema.json')
case(v,mut(sc,lambda x:x['tests'][0].update(bug="BUG-001")),True,"scenario bug test")
case(v,mut(sc,lambda x:x['tests'][0].update(bug="F-001")),False,"scenario bad bug id")

# ---- part C re-check (K1) ----
v=V('bugs/report.schema.json')
case(v,mut(nf,lambda x:x.update(status="decided",decision={"category":"bug","decided_at":"2026-11-21T10:30:00Z"})),False,"K1 human picks bug on new-feature proposal")
case(v,mut(rep,lambda x:x.update(status="decided",decision={"category":"change","decided_at":"2026-11-21T10:30:00Z","new_spec_version":3})),False,"K1 change decision on bug proposal")
case(v,mut(ch,lambda x:x.update(status="decided",decision={"category":"change","decided_at":"2026-11-21T10:30:00Z"})),False,"change decision without new spec version")
case(v,mut(ch,lambda x:x.update(status="decided",decision={"category":"change","decided_at":"2026-11-21T10:30:00Z","new_spec_version":3})),True,"change decided valid")
case(v,mut(rep,lambda x:x.update(status="decided",decision={"category":"new_feature","decided_at":"2026-11-21T10:30:00Z","new_feature_id":"F-007"})),True,"human picks new feature")

# --- self-audit 2026-11-21 additions ---
v=V('spec/spec.schema.json')
ui=mut(spec,lambda x:x.update(ui_reference={"screens":[{"name":"New booking","route":"/bookings/new","description":"Form with label Date"}]}))
case(v,ui,True,"spec screen with route")
case(v,mut(ui,lambda x:x['ui_reference']['screens'][0].pop('route')),False,"spec screen without route")
case(v,mut(ui,lambda x:x['ui_reference']['screens'][0].update(route="bookings")),False,"spec route not absolute")
case(v,mut(spec,lambda x:x.update(status="released")),True,"spec released status")
sup=mut(spec,lambda x:x.update(supersedes=[{"feature_id":"F-002","ac":"AC-002-01","op":"modify","text":"List shows only own bookings after login.","reason":"login"}]))
case(v,sup,True,"spec supersedes modify")
case(v,mut(sup,lambda x:x['supersedes'][0].pop('text')),False,"spec supersedes modify without text")
case(v,mut(sup,lambda x:x['supersedes'][0].update(op="remove")),False,"spec supersedes remove with text")
v=V('build-report/build-report.schema.json')
sk={"mode":"skeleton","summary":"Leeres Projekt.","summary_language":"de","deviations":[],"assumptions":[],"risks":[],"commands":{"install":"npm ci","dev":"npm run dev","test":"npm test","lint":"npm run lint","build":"npm run build","start":"npm run start","seed":"npm run seed"}}
case(v,sk,True,"build report skeleton")
case(v,mut(sk,lambda x:x.update(feature_id="F-001")),False,"build report skeleton with feature")
case(v,mut(sk,lambda x:x['commands'].pop('seed')),False,"build report skeleton without seed")
case(v,mut(br,lambda x:x.update(commands=sk['commands'])),False,"build report feature with commands")
v=V('gate-report/gate-report.schema.json')
gs={"mode":"skeleton","commit":H,"main_commit":"b"*40,"tested_tree":"c"*40,"gate_policy_version":1,"round":1,"created_at":"2026-11-21T10:00:00Z","gates":[{"name":"build","dod_item":"DOD-1","status":"passed"}]}
case(v,gs,True,"gate report skeleton")
case(v,mut(gs,lambda x:x.update(acceptance_criteria=[{"id":"AC-001-01","status":"passed"}])),False,"gate report skeleton with AC")
case(v,mut(gr,lambda x:x.pop('tested_tree')),False,"gate report without tested tree")
case(v,mut(gr,lambda x:x.pop('acceptance_criteria')),False,"gate report feature without AC")
v=V('review/review-report.schema.json')
v=V('question/question-answer.schema.json')
qa={"question":{"id":"q-1","kind":"question","step":"C1","run_id":"r1","language":"de","finding":"f","decision_needed":"d","recommendation":{"answer":"a","reason":"r"}},
 "answer":{"text":"","attachments":[{"path":"bugs/BUG-002/attachments/log.txt","media_type":"text/plain","sha256":"a"*64}],"answered_by":"human","answered_at":"2026-11-21T10:00:00Z"}}
case(v,qa,True,"answer with bug attachment")
case(v,mut(qa,lambda x:x['answer']['attachments'][0].update(path="features/F-003/attachments/sketch.png")),True,"answer with feature attachment")
case(v,mut(qa,lambda x:x['answer']['attachments'][0].update(path="src/app.ts")),False,"answer attachment outside allowed folders")
qd=mut(qa,lambda x:x['question'].update(options=[{"label":"Today allowed","consequences":"c","spec_delta":[{"op":"modify","target":"AC-004-03","text":"A booking for today is accepted."}]}]))
case(v,qd,True,"question option with spec delta")
case(v,mut(qd,lambda x:x['question']['options'][0]['spec_delta'][0].update(target="X-1")),False,"question option bad delta target")
v=V('interview/interview-log.schema.json')
lg={"step":"C1","item":"BUG-002","status":"running","entries":[]}
case(v,lg,True,"question log for triage")
case(v,mut(lg,lambda x:x.update(step="A2")),False,"question log A2 without inventory version")
v=V('dor-dod/checklist.schema.json')
dor={"kind":"definition-of-ready","version":1,"stack_profile":"nextjs-postgres","items":[{"id":"DOR-1","text":"Every AC has an ID","mandatory":True,"verification":"automated"}]}
case(v,dor,True,"DoR automated item without gate")
case(v,mut(dor,lambda x:(x.update(kind="definition-of-done"),x['items'][0].update(id="DOD-1"))),False,"DoD automated item without gate")
v=V('stack-profile/profile.schema.json')
prof=json.load(open(T+'../stacks/nextjs-postgres/profile.json'))
case(v,prof,True,"stack profile nextjs-postgres")
case(v,mut(prof,lambda x:x['commands'].pop('seed')),False,"stack profile without seed")
case(v,mut(prof,lambda x:x['commands'].pop('start')),False,"stack profile without start")
case(v,mut(prof,lambda x:x['tests'].update(fresh_services_per_run=False)),False,"stack profile without fresh services")
print(f"{ok} passed, {bad} failed")
sys.exit(1 if bad else 0)
