// 신호등 친구들 캐릭터 그리기 (12지 · 모자/옷/신발 · 부자 표시 · 표정) — blog_assets/캐릭터_만들기_데모.html 에서 가져옴
// GameChars.draw(animalId, {hat,outfit,shoes,pt,mood,hungry,umbrella}, uid, mini) → SVG 문자열
(function () {
const C={ink:"#1B2233",up:"#E5484D",wait:"#F5B400",dn:"#2F6FDB",blush:"#FF9FB0",gold:"#FFC93C",goldD:"#D99A00"};
function shade(hex,a){const n=parseInt(hex.slice(1),16);let r=n>>16,g=n>>8&255,b=n&255;const t=a>0?255:0,p=Math.abs(a);r=Math.round(r+(t-r)*p);g=Math.round(g+(t-g)*p);b=Math.round(b+(t-b)*p);return "#"+((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1);}
// 12지: 투자 성향 한 줄 + 색 + 머리 장식(back: 머리 뒤, front: 얼굴 위)
const Z=[
 {id:"rat",n:"찍찍이",a:"쥐",s:"⚡ 빠른 단타 · 눈치 백단",body:"#B9B9C9",belly:"#ECECF3"},
 {id:"ox",n:"우직이",a:"소",s:"🐂 우직한 장기투자",body:"#9A6644",belly:"#E8C9A8"},
 {id:"tiger",n:"범돌이",a:"호랑이",s:"🔥 공격적인 승부사",body:"#FF9F2E",belly:"#FFF3E2"},
 {id:"rabbit",n:"토토",a:"토끼",s:"🌸 상승장을 깡충깡충",body:"#FFFFFF",belly:"#FFE4EC",outline:true},
 {id:"dragon",n:"용용이",a:"용",s:"🐉 대박을 노리는 야망가",body:"#4CC38A",belly:"#D9F5E6"},
 {id:"snake",n:"스르르",a:"뱀",s:"🧊 냉철한 분석가",body:"#8BC34A",belly:"#E9F6D6"},
 {id:"horse",n:"달려라",a:"말",s:"🏇 추세 따라 질주",body:"#B97A4E",belly:"#F0D9C2"},
 {id:"sheep",n:"뭉게",a:"양",s:"☁️ 분산투자 안전파",body:"#F6E7D6",belly:"#FFF8F0"},
 {id:"monkey",n:"재롱이",a:"원숭이",s:"🧠 재치 있는 차트 분석",body:"#A0673F",belly:"#F1D6B8"},
 {id:"rooster",n:"꼬꼬",a:"닭",s:"🌅 새벽 코인 얼리버드",body:"#FFFFFF",belly:"#FFF4DA",outline:true},
 {id:"dog",n:"멍이",a:"개",s:"🐾 충직한 꾸준함",body:"#C99A6B",belly:"#F2DEC6"},
 {id:"pig",n:"복돼지",a:"돼지",s:"🍀 복을 부르는 재물운",body:"#FFB3C4",belly:"#FFE1E8"}
];
const HAT=[{id:"none",n:"없음",lv:1},{id:"cap",n:"야구모자",lv:1},{id:"beanie",n:"비니",lv:3},{id:"party",n:"파티 고깔",lv:5},{id:"helmet",n:"신호등 헬멧",lv:10},{id:"tophat",n:"실크햇",lv:20},{id:"crown",n:"왕관",lv:30}];
const OUT=[{id:"none",n:"없음",lv:1},{id:"tee",n:"AI 티셔츠",lv:1},{id:"hoodie",n:"후드티",lv:5},{id:"hanbok",n:"한복",lv:10},{id:"suit",n:"정장",lv:15},{id:"cape",n:"황금 망토",lv:25}];
const SHO=[{id:"none",n:"맨발",lv:1},{id:"sneakers",n:"운동화",lv:1},{id:"boots",n:"장화",lv:7},{id:"loafers",n:"구두",lv:15},{id:"gold",n:"황금 신발",lv:28}];
const G=id=>`url(#h-${id})`, GB=id=>`url(#b-${id})`;
function defs(z,uid){return `<defs><radialGradient id="h-${uid}" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="${shade(z.body,.45)}"/><stop offset=".55" stop-color="${z.body}"/><stop offset="1" stop-color="${shade(z.body,-.2)}"/></radialGradient><radialGradient id="b-${uid}" cx="40%" cy="25%" r="80%"><stop offset="0" stop-color="${shade(z.body,.3)}"/><stop offset="1" stop-color="${shade(z.body,-.18)}"/></radialGradient></defs>`;}
// 머리 뒤 (귀·뿔·갈기)
function back(z,cx,cy,r,uid){
  const o=z.outline?`stroke="#E3D3DA" stroke-width="2"`:"", E=(x,c="")=>`<g class="ear ${c}">${x}</g>`;
  switch(z.id){
    case "rat":return E(`<circle cx="${cx-r*.78}" cy="${cy-r*.62}" r="${r*.42}" fill="${G(uid)}"/><circle cx="${cx-r*.78}" cy="${cy-r*.62}" r="${r*.25}" fill="${C.blush}"/>`)+E(`<circle cx="${cx+r*.78}" cy="${cy-r*.62}" r="${r*.42}" fill="${G(uid)}"/><circle cx="${cx+r*.78}" cy="${cy-r*.62}" r="${r*.25}" fill="${C.blush}"/>`,"r");
    case "ox":return `<path d="M${cx-r*.7},${cy-r*.6} q${-r*.55},${-r*.15} ${-r*.5},${-r*.75} q${r*.2},${r*.35} ${r*.62},${r*.45}Z" fill="#F4E6C8" stroke="#D9C49A" stroke-width="2"/><path d="M${cx+r*.7},${cy-r*.6} q${r*.55},${-r*.15} ${r*.5},${-r*.75} q${-r*.2},${r*.35} ${-r*.62},${r*.45}Z" fill="#F4E6C8" stroke="#D9C49A" stroke-width="2"/>`+E(`<ellipse cx="${cx-r*1.02}" cy="${cy-r*.12}" rx="${r*.28}" ry="${r*.14}" fill="${z.body}" transform="rotate(-20 ${cx-r} ${cy})"/>`)+E(`<ellipse cx="${cx+r*1.02}" cy="${cy-r*.12}" rx="${r*.28}" ry="${r*.14}" fill="${z.body}" transform="rotate(20 ${cx+r} ${cy})"/>`,"r");
    case "tiger":case "dog":case "monkey":case "pig":{
      if(z.id==="dog") return E(`<ellipse cx="${cx-r*.9}" cy="${cy}" rx="${r*.3}" ry="${r*.6}" fill="#8A6343" transform="rotate(18 ${cx-r*.9} ${cy})"/>`)+E(`<ellipse cx="${cx+r*.9}" cy="${cy}" rx="${r*.3}" ry="${r*.6}" fill="#8A6343" transform="rotate(-18 ${cx+r*.9} ${cy})"/>`,"r");
      if(z.id==="monkey") return E(`<circle cx="${cx-r*.98}" cy="${cy}" r="${r*.32}" fill="${G(uid)}"/><circle cx="${cx-r*.98}" cy="${cy}" r="${r*.18}" fill="${z.belly}"/>`)+E(`<circle cx="${cx+r*.98}" cy="${cy}" r="${r*.32}" fill="${G(uid)}"/><circle cx="${cx+r*.98}" cy="${cy}" r="${r*.18}" fill="${z.belly}"/>`,"r");
      if(z.id==="pig") return E(`<path d="M${cx-r*.75},${cy-r*.55} L${cx-r*.9},${cy-r*1.05} L${cx-r*.3},${cy-r*.85}Z" fill="${shade(z.body,-.08)}"/>`)+E(`<path d="M${cx+r*.75},${cy-r*.55} L${cx+r*.9},${cy-r*1.05} L${cx+r*.3},${cy-r*.85}Z" fill="${shade(z.body,-.08)}"/>`,"r");
      return E(`<circle cx="${cx-r*.72}" cy="${cy-r*.72}" r="${r*.3}" fill="${G(uid)}"/><circle cx="${cx-r*.72}" cy="${cy-r*.72}" r="${r*.15}" fill="${C.ink}" opacity=".6"/>`)+E(`<circle cx="${cx+r*.72}" cy="${cy-r*.72}" r="${r*.3}" fill="${G(uid)}"/><circle cx="${cx+r*.72}" cy="${cy-r*.72}" r="${r*.15}" fill="${C.ink}" opacity=".6"/>`,"r");}
    case "rabbit":return E(`<ellipse cx="${cx-r*.36}" cy="${cy-r*1.32}" rx="${r*.2}" ry="${r*.6}" fill="${G(uid)}" ${o}/><ellipse cx="${cx-r*.36}" cy="${cy-r*1.3}" rx="${r*.09}" ry="${r*.44}" fill="${C.blush}"/>`)+E(`<ellipse cx="${cx+r*.36}" cy="${cy-r*1.32}" rx="${r*.2}" ry="${r*.6}" fill="${G(uid)}" ${o}/><ellipse cx="${cx+r*.36}" cy="${cy-r*1.3}" rx="${r*.09}" ry="${r*.44}" fill="${C.blush}"/>`,"r");
    case "dragon":{let s="";for(let i=-2;i<=2;i++){s+=`<path d="M${cx+i*r*.22-r*.1},${cy-r*.9+Math.abs(i)*r*.08} l${r*.1},${-r*.28} l${r*.1},${r*.28}Z" fill="#2E9E68"/>`;}
      return s+`<path d="M${cx-r*.5},${cy-r*.75} q${-r*.15},${-r*.5} ${-r*.4},${-r*.65} q${r*.4},${0} ${r*.55},${r*.5}Z" fill="${C.gold}"/><path d="M${cx+r*.5},${cy-r*.75} q${r*.15},${-r*.5} ${r*.4},${-r*.65} q${-r*.4},${0} ${-r*.55},${r*.5}Z" fill="${C.gold}"/>`;}
    case "horse":return E(`<path d="M${cx-r*.55},${cy-r*.65} L${cx-r*.55},${cy-r*1.25} L${cx-r*.2},${cy-r*.88}Z" fill="${G(uid)}"/>`)+E(`<path d="M${cx+r*.55},${cy-r*.65} L${cx+r*.55},${cy-r*1.25} L${cx+r*.2},${cy-r*.88}Z" fill="${G(uid)}"/>`,"r")+`<path d="M${cx-r*.25},${cy-r*1.02} q${r*.25},${-r*.3} ${r*.5},0 q${-r*.05},${r*.25} ${-r*.25},${r*.2}Z" fill="#5A3A22"/>`;
    case "sheep":{let s="";for(let i=0;i<10;i++){const a=Math.PI*(1.05+i*0.09);s+=`<circle cx="${cx+Math.cos(a)*r*.95}" cy="${cy+Math.sin(a)*r*.95+r*.1}" r="${r*.3}" fill="#FFFFFF" stroke="#EDE3D6" stroke-width="1.5"/>`;}
      return s+`<path d="M${cx-r*.95},${cy-r*.1} a${r*.22},${r*.22} 0 1 1 ${r*.1},${r*.4}" fill="none" stroke="#B88A5A" stroke-width="${r*.12}" stroke-linecap="round"/><path d="M${cx+r*.95},${cy-r*.1} a${r*.22},${r*.22} 0 1 0 ${-r*.1},${r*.4}" fill="none" stroke="#B88A5A" stroke-width="${r*.12}" stroke-linecap="round"/>`;}
    case "rooster":return `<path d="M${cx-r*.3},${cy-r*.85} a${r*.16},${r*.16} 0 0 1 ${r*.2},${-r*.25} a${r*.17},${r*.17} 0 0 1 ${r*.24},${-r*.05} a${r*.16},${r*.16} 0 0 1 ${r*.2},${r*.2} Z" fill="${C.up}"/>`;
    default:return "";
  }
}
// 얼굴 (눈·볼·코/주둥이·무늬)
function face(z,cx,cy,r,mood){
  let g="";
  if(mood==="sleep"||mood==="sad"){ // 눈 대신 감은 눈 / 처진 눈썹 + 눈물
    const f=face(z,cx,cy,r,"");
    const ey=cy-r*.02, ex=r*.34;
    let over=mood==="sleep"
      ?`<path d="M${cx-ex-r*.13},${ey} q${r*.13},${r*.1} ${r*.26},0 M${cx+ex-r*.13},${ey} q${r*.13},${r*.1} ${r*.26},0" stroke="${C.ink}" stroke-width="${r*.05}" fill="none" stroke-linecap="round"/>`
      :`<path d="M${cx-ex-r*.15},${ey-r*.14} l${r*.25},${-r*.09} M${cx+ex+r*.15},${ey-r*.14} l${-r*.25},${-r*.09}" stroke="${C.ink}" stroke-width="${r*.05}" stroke-linecap="round"/><path d="M${cx+ex+r*.02},${ey+r*.12} q${r*.08},${r*.18} 0,${r*.22} q${-r*.08},${-r*.04} 0,${-r*.22}Z" fill="#7CC4FF"/>`;
    return mood==="sleep"?f.replace(/<g class="eyes">[\s\S]*?<\/g>/,"")+over:f+over;
  }
  if(z.id==="monkey") g+=`<path d="M${cx},${cy+r*.62} C${cx-r*.85},${cy+r*.5} ${cx-r*.75},${cy-r*.45} ${cx-r*.2},${cy-r*.3} Q${cx},${cy-r*.15} ${cx+r*.2},${cy-r*.3} C${cx+r*.75},${cy-r*.45} ${cx+r*.85},${cy+r*.5} ${cx},${cy+r*.62}Z" fill="${z.belly}"/>`;
  if(z.id==="tiger"){g+=`<ellipse cx="${cx}" cy="${cy+r*.35}" rx="${r*.45}" ry="${r*.3}" fill="${z.belly}"/>`;for(const s of[-1,1])g+=`<path d="M${cx+s*r*.98},${cy} l${-s*r*.25},${r*.05} M${cx+s*r*.95},${cy+r*.18} l${-s*r*.22},${r*.02}" stroke="${C.ink}" stroke-width="${r*.07}" stroke-linecap="round"/>`;
    g+=`<path d="M${cx},${cy-r*.95} v${r*.25} M${cx-r*.18},${cy-r*.9} v${r*.18} M${cx+r*.18},${cy-r*.9} v${r*.18}" stroke="${C.ink}" stroke-width="${r*.07}" stroke-linecap="round"/>`;}
  if(z.id==="snake") for(const [dx,dy] of [[-.55,-.45],[.5,-.55],[0,-.75],[.7,.05]]) g+=`<circle cx="${cx+dx*r}" cy="${cy+dy*r}" r="${r*.09}" fill="#5E9A2A" opacity=".7"/>`;
  if(z.id==="dragon") g+=`<path d="M${cx-r*.35},${cy+r*.42} q${-r*.4},${r*.05} ${-r*.6},${r*.35} M${cx+r*.35},${cy+r*.42} q${r*.4},${r*.05} ${r*.6},${r*.35}" stroke="#2E9E68" stroke-width="${r*.05}" fill="none" stroke-linecap="round"/>`;
  const ey=cy-r*.02, ex=r*.34, er=r*.12, eyeC=C.ink;
  g+=`<g class="eyes">`+(z.id==="snake"?`<ellipse cx="${cx-ex}" cy="${ey}" rx="${er}" ry="${er*1.1}" fill="#FFE066"/><ellipse cx="${cx+ex}" cy="${ey}" rx="${er}" ry="${er*1.1}" fill="#FFE066"/><ellipse cx="${cx-ex}" cy="${ey}" rx="${er*.3}" ry="${er*.9}" fill="${eyeC}"/><ellipse cx="${cx+ex}" cy="${ey}" rx="${er*.3}" ry="${er*.9}" fill="${eyeC}"/>`
     :`<circle cx="${cx-ex}" cy="${ey}" r="${er}" fill="${eyeC}"/><circle cx="${cx+ex}" cy="${ey}" r="${er}" fill="${eyeC}"/><circle cx="${cx-ex+er*.35}" cy="${ey-er*.4}" r="${er*.35}" fill="#fff"/><circle cx="${cx+ex+er*.35}" cy="${ey-er*.4}" r="${er*.35}" fill="#fff"/>`)+`</g>`;
  g+=`<ellipse cx="${cx-r*.6}" cy="${cy+r*.25}" rx="${r*.15}" ry="${r*.09}" fill="${C.blush}" opacity=".85"/><ellipse cx="${cx+r*.6}" cy="${cy+r*.25}" rx="${r*.15}" ry="${r*.09}" fill="${C.blush}" opacity=".85"/>`;
  const ny=cy+r*.25;
  const smile=(y,c=C.ink)=>`<path d="M${cx},${y} q${-r*.07},${r*.12} ${-r*.15},${r*.06} M${cx},${y} q${r*.07},${r*.12} ${r*.15},${r*.06}" stroke="${c}" stroke-width="${r*.035}" fill="none" stroke-linecap="round"/>`;
  switch(z.id){
    case "ox":g+=`<ellipse cx="${cx}" cy="${cy+r*.42}" rx="${r*.48}" ry="${r*.28}" fill="${z.belly}"/><ellipse cx="${cx-r*.17}" cy="${cy+r*.42}" rx="${r*.06}" ry="${r*.08}" fill="${shade(z.body,-.3)}"/><ellipse cx="${cx+r*.17}" cy="${cy+r*.42}" rx="${r*.06}" ry="${r*.08}" fill="${shade(z.body,-.3)}"/><path d="M${cx-r*.1},${cy+r*.62} a${r*.1},${r*.1} 0 1 0 ${r*.2},0" fill="none" stroke="${C.gold}" stroke-width="${r*.05}"/>`;break;
    case "horse":g+=`<ellipse cx="${cx}" cy="${cy+r*.45}" rx="${r*.42}" ry="${r*.3}" fill="${z.belly}"/><circle cx="${cx-r*.15}" cy="${cy+r*.45}" r="${r*.05}" fill="${shade(z.body,-.35)}"/><circle cx="${cx+r*.15}" cy="${cy+r*.45}" r="${r*.05}" fill="${shade(z.body,-.35)}"/>`;break;
    case "pig":g+=`<ellipse cx="${cx}" cy="${cy+r*.35}" rx="${r*.3}" ry="${r*.2}" fill="${shade(z.body,-.12)}"/><ellipse cx="${cx-r*.1}" cy="${cy+r*.35}" rx="${r*.05}" ry="${r*.08}" fill="${shade(z.body,-.4)}"/><ellipse cx="${cx+r*.1}" cy="${cy+r*.35}" rx="${r*.05}" ry="${r*.08}" fill="${shade(z.body,-.4)}"/>`;break;
    case "rooster":g+=`<path d="M${cx-r*.14},${ny-r*.06} L${cx+r*.14},${ny-r*.06} L${cx},${ny+r*.14}Z" fill="#FF9A1F"/><ellipse cx="${cx}" cy="${ny+r*.25}" rx="${r*.07}" ry="${r*.11}" fill="${C.up}"/>`;break;
    case "snake":g+=`<path d="M${cx},${ny+r*.08} v${r*.18} l${-r*.06},${r*.07} M${cx},${ny+r*.26} l${r*.06},${r*.07}" stroke="${C.up}" stroke-width="${r*.04}" fill="none" stroke-linecap="round"/>`;break;
    case "dragon":g+=`<circle cx="${cx-r*.1}" cy="${ny}" r="${r*.04}" fill="#2E9E68"/><circle cx="${cx+r*.1}" cy="${ny}" r="${r*.04}" fill="#2E9E68"/>`+smile(ny+r*.06,"#2E9E68");break;
    case "rat":g+=`<ellipse cx="${cx}" cy="${ny-r*.02}" rx="${r*.08}" ry="${r*.06}" fill="${C.blush}"/>`+smile(ny+r*.03)+`<rect x="${cx-r*.06}" y="${ny+r*.12}" width="${r*.12}" height="${r*.1}" rx="${r*.02}" fill="#fff" stroke="#ccc" stroke-width="1"/><path d="M${cx-r*.25},${ny} l${-r*.4},${-r*.05} M${cx-r*.25},${ny+r*.08} l${-r*.4},${r*.05} M${cx+r*.25},${ny} l${r*.4},${-r*.05} M${cx+r*.25},${ny+r*.08} l${r*.4},${r*.05}" stroke="${C.ink}" stroke-width="${r*.025}" opacity=".45"/>`;break;
    case "rabbit":case "tiger":g+=`<path d="M${cx-r*.07},${ny-r*.06} L${cx+r*.07},${ny-r*.06} L${cx},${ny+r*.02}Z" fill="${z.id==="tiger"?C.ink:C.blush}"/>`+smile(ny+r*.02);break;
    default:g+=`<ellipse cx="${cx}" cy="${ny-r*.02}" rx="${r*.1}" ry="${r*.07}" fill="${C.ink}"/>`+smile(ny+r*.04);
  }
  g+=`<ellipse cx="${cx-r*.42}" cy="${cy-r*.55}" rx="${r*.22}" ry="${r*.12}" fill="#fff" opacity=".45" transform="rotate(-30 ${cx-r*.42} ${cy-r*.55})"/>`;
  return g;
}
// 옷
function outfit(id,cx,ty,tw,th){
  const torso=(f)=>`<path d="M${cx-tw},${ty+th*.35} Q${cx-tw},${ty} ${cx},${ty} Q${cx+tw},${ty} ${cx+tw},${ty+th*.35} L${cx+tw*.95},${ty+th} Q${cx},${ty+th*1.12} ${cx-tw*.95},${ty+th}Z" fill="${f}"/>`;
  switch(id){
    case "tee":return torso("#3B82F6")+`<text x="${cx}" y="${ty+th*.66}" text-anchor="middle" font-size="${th*.36}" font-weight="900" fill="#fff" font-family="Arial">AI</text>`;
    case "hoodie":return torso("#22A06B")+`<path d="M${cx-tw*.55},${ty+th*.05} Q${cx},${ty+th*.45} ${cx+tw*.55},${ty+th*.05}" fill="none" stroke="#178052" stroke-width="4"/><rect x="${cx-tw*.45}" y="${ty+th*.55}" width="${tw*.9}" height="${th*.3}" rx="6" fill="#178052"/>`;
    case "hanbok":return torso("#FF6B8A")+`<path d="M${cx-tw*.1},${ty+th*.02} L${cx+tw*.35},${ty+th*.5} L${cx-tw*.1},${ty+th*.5}Z" fill="#fff"/><path d="M${cx+tw*.05},${ty+th*.45} q${tw*.35},${th*.25} ${tw*.05},${th*.55}" stroke="${C.up}" stroke-width="5" fill="none" stroke-linecap="round"/><rect x="${cx-tw}" y="${ty+th*.78}" width="${tw*2}" height="${th*.25}" rx="6" fill="#4C6EF5"/>`;
    case "suit":return torso("#2B3550")+`<path d="M${cx-tw*.35},${ty} L${cx},${ty+th*.55} L${cx+tw*.35},${ty}Z" fill="#fff"/><path d="M${cx-tw*.08},${ty+th*.12} L${cx+tw*.08},${ty+th*.12} L${cx+tw*.1},${ty+th*.55} L${cx},${ty+th*.68} L${cx-tw*.1},${ty+th*.55}Z" fill="${C.up}"/>`;
    case "cape":return `<path d="M${cx-tw*1.05},${ty+th*.1} Q${cx-tw*1.7},${ty+th*1.3} ${cx-tw*.9},${ty+th*1.2} L${cx+tw*.9},${ty+th*1.2} Q${cx+tw*1.7},${ty+th*1.3} ${cx+tw*1.05},${ty+th*.1}Z" fill="#E0A800"/>`+torso("#FFD24D")+`<circle cx="${cx}" cy="${ty+th*.3}" r="${th*.11}" fill="${C.up}"/>`;
    default:return "";
  }
}
function hat(id,cx,top,r){
  switch(id){
    case "cap":return `<path d="M${cx-r*.72},${top+r*.32} Q${cx-r*.7},${top-r*.28} ${cx},${top-r*.3} Q${cx+r*.7},${top-r*.28} ${cx+r*.72},${top+r*.32}Z" fill="${C.up}"/><path d="M${cx+r*.35},${top+r*.28} q${r*.6},${-r*.02} ${r*.75},${r*.18} q${-r*.35},${r*.12} ${-r*.8},${r*.02}Z" fill="#B8262B"/><circle cx="${cx}" cy="${top-r*.3}" r="${r*.07}" fill="#B8262B"/>`;
    case "beanie":return `<path d="M${cx-r*.75},${top+r*.35} Q${cx-r*.7},${top-r*.4} ${cx},${top-r*.42} Q${cx+r*.7},${top-r*.4} ${cx+r*.75},${top+r*.35}Z" fill="#4C6EF5"/><rect x="${cx-r*.8}" y="${top+r*.18}" width="${r*1.6}" height="${r*.25}" rx="${r*.1}" fill="#364FC7"/><circle cx="${cx}" cy="${top-r*.5}" r="${r*.16}" fill="#fff"/>`;
    case "party":return `<path d="M${cx-r*.42},${top+r*.22} L${cx},${top-r*.85} L${cx+r*.42},${top+r*.22}Z" fill="#FFD43B"/><path d="M${cx-r*.28},${top-r*.12} L${cx+r*.3},${top+r*.02} M${cx-r*.15},${top-r*.45} L${cx+r*.18},${top-r*.36}" stroke="${C.up}" stroke-width="${r*.08}"/><circle cx="${cx}" cy="${top-r*.88}" r="${r*.1}" fill="${C.dn}"/>`;
    case "helmet":return `<path d="M${cx-r*.82},${top+r*.42} Q${cx-r*.8},${top-r*.35} ${cx},${top-r*.38} Q${cx+r*.8},${top-r*.35} ${cx+r*.82},${top+r*.42}Z" fill="#2A3245"/><circle cx="${cx-r*.3}" cy="${top}" r="${r*.11}" fill="${C.up}"/><circle cx="${cx}" cy="${top-r*.08}" r="${r*.11}" fill="${C.wait}"/><circle cx="${cx+r*.3}" cy="${top}" r="${r*.11}" fill="${C.dn}"/>`;
    case "tophat":return `<ellipse cx="${cx}" cy="${top+r*.2}" rx="${r*.75}" ry="${r*.14}" fill="#111"/><rect x="${cx-r*.45}" y="${top-r*.7}" width="${r*.9}" height="${r*.9}" rx="${r*.06}" fill="#1B1B1F"/><rect x="${cx-r*.45}" y="${top-r*.02}" width="${r*.9}" height="${r*.16}" fill="${C.up}"/>`;
    case "crown":return `<path d="M${cx-r*.55},${top+r*.2} L${cx-r*.6},${top-r*.38} L${cx-r*.28},${top-r*.12} L${cx},${top-r*.5} L${cx+r*.28},${top-r*.12} L${cx+r*.6},${top-r*.38} L${cx+r*.55},${top+r*.2}Z" fill="${C.gold}" stroke="${C.goldD}" stroke-width="2"/><circle cx="${cx-r*.28}" cy="${top+r*.02}" r="${r*.07}" fill="${C.up}"/><circle cx="${cx}" cy="${top-r*.02}" r="${r*.07}" fill="${C.wait}"/><circle cx="${cx+r*.28}" cy="${top+r*.02}" r="${r*.07}" fill="${C.dn}"/>`;
    default:return "";
  }
}
function shoes(id,z,cx,fy,uid){
  const col={none:null,sneakers:"#E5484D",boots:"#FFD43B",loafers:"#1B1B1F",gold:C.gold}[id];
  const one=x=>id==="none"?`<ellipse cx="${x}" cy="${fy}" rx="14" ry="8" fill="${shade(z.body,-.1)}" ${z.outline?'stroke="#E3D3DA" stroke-width="2"':''}/>`
    :id==="boots"?`<rect x="${x-12}" y="${fy-16}" width="24" height="20" rx="5" fill="${col}"/><ellipse cx="${x+2}" cy="${fy+3}" rx="15" ry="6" fill="${col}"/>`
    :`<ellipse cx="${x+2}" cy="${fy}" rx="16" ry="9" fill="${col}"/>`+(id==="sneakers"?`<path d="M${x-10},${fy+4} h22" stroke="#fff" stroke-width="3"/>`:"")+(id==="gold"?`<circle class="spark" cx="${x+8}" cy="${fy-6}" r="2.5" fill="#fff"/>`:"");
  return one(cx-20)+one(cx+20);
}
// 부자 표시 (오른쪽 위)
function wealth(pt,x,y){
  const coin=(cx,cy,s=11)=>`<g class="coin" style="animation-delay:${(cx+cy)%7*.15}s"><circle cx="${cx}" cy="${cy}" r="${s}" fill="${C.gold}" stroke="${C.goldD}" stroke-width="2"/><text x="${cx}" y="${cy+s*.38}" text-anchor="middle" font-size="${s*1.05}" font-weight="900" fill="${C.goldD}" font-family="Arial">$</text></g>`;
  let g="";
  if(pt>=10000000) g+=`<circle class="aura" cx="100" cy="125" r="96" fill="url(#aura)"/>`;
  else if(pt>=3000000) g+=`<circle class="aura" cx="100" cy="125" r="90" fill="url(#aura)"/>`;
  if(pt>=1000000){
    g+=`<g class="coin"><path d="M${x-14},${y-8} q14,-14 28,0 q10,26 -14,30 q-24,-4 -14,-30Z" fill="#C9852B"/><path d="M${x-8},${y-12} q8,-6 16,0" stroke="#7A4E14" stroke-width="3" fill="none"/><text x="${x}" y="${y+14}" text-anchor="middle" font-size="16" font-weight="900" fill="#FFE8A8" font-family="Arial">$</text></g>`;
    if(pt>=3000000) g+=`<path d="M${x-40},${y+30} l10,-10 h22 l10,10Z" fill="${C.gold}" stroke="${C.goldD}" stroke-width="2"/><path d="M${x-35},${y+18} l8,-8 h18 l8,8Z" fill="#FFE08A" stroke="${C.goldD}" stroke-width="2"/>`;
    if(pt>=10000000) g+=`<path class="spark" d="M${x-46},${y-14} l7,-8 h12 l7,8 l-13,16Z" fill="#7FE7FF" stroke="#2AB3D9" stroke-width="2"/>`;
    g+=`<text x="${x+22}" y="${y-14}" font-size="15" font-weight="900" fill="${C.goldD}" font-family="Arial">${pt>=10000000?"$$$$":pt>=3000000?"$$$":"$$"}</text>`;
  } else if(pt>=600000){ for(let i=0;i<4;i++) g+=coin(x-14+i*9,y+14-i*3,10); g+=coin(x,y-8,12)+coin(x+18,y+4,10);
  } else { const n=Math.min(5,Math.floor(pt/100000)); for(let i=0;i<n;i++) g+=coin(x-(i%3)*20+20,y+Math.floor(i/3)*-22+10,11);
     }
  return g;
}
function drawChar(z,o,uid,mini){
  const cx=100, hy=82, r=46, ty=118, tw=30, th=50, fy=176;
  let g="";
  if(o.outfit==="cape") g+=outfit("cape",cx,ty,tw,th).split("</path>")[0]+"</path>"; // 망토는 몸 뒤
  // 꼬리(뱀·용·원숭이·소·호랑이·말)
  if(["snake","dragon","monkey","tiger"].includes(z.id)) g+=`<g class="ear r"><path d="M${cx+tw*.8},${ty+th*.7} q${40},${-5} ${30},${-40}" stroke="${z.body}" stroke-width="${z.id==="snake"?14:8}" fill="none" stroke-linecap="round"/></g>`;
  // 몸통 + 팔 + 발
  g+=`<ellipse cx="${cx-tw-4}" cy="${ty+th*.38}" rx="9" ry="15" fill="${GB(uid)}" transform="rotate(20 ${cx-tw-4} ${ty+th*.38})"/><ellipse cx="${cx+tw+4}" cy="${ty+th*.38}" rx="9" ry="15" fill="${GB(uid)}" transform="rotate(-20 ${cx+tw+4} ${ty+th*.38})"/>`;
  g+=`<path d="M${cx-tw},${ty+th*.35} Q${cx-tw},${ty} ${cx},${ty} Q${cx+tw},${ty} ${cx+tw},${ty+th*.35} L${cx+tw*.95},${ty+th} Q${cx},${ty+th*1.12} ${cx-tw*.95},${ty+th}Z" fill="${GB(uid)}" ${z.outline?'stroke="#E3D3DA" stroke-width="2"':""}/><ellipse cx="${cx}" cy="${ty+th*.6}" rx="${tw*.6}" ry="${th*.32}" fill="${z.belly}"/>`;
  if(o.outfit!=="none") g+=o.outfit==="cape"?outfit("cape",cx,ty,tw,th).replace(/^[\s\S]*?<\/path>/,""):outfit(o.outfit,cx,ty,tw,th);
  g+=shoes(o.shoes,z,cx,fy,uid);
  // 머리
  g+=back(z,cx,hy,r,uid);
  g+=`<ellipse cx="${cx}" cy="${hy}" rx="${r}" ry="${r*.95}" fill="${G(uid)}" ${z.outline?'stroke="#E3D3DA" stroke-width="2"':""}/>`;
  g+=face(z,cx,hy,r,o.mood);
  if(o.pt>=10000000&&!mini) g+=`<rect x="${cx-r*.62}" y="${hy-r*.18}" width="${r*.5}" height="${r*.3}" rx="${r*.1}" fill="#111"/><rect x="${cx+r*.12}" y="${hy-r*.18}" width="${r*.5}" height="${r*.3}" rx="${r*.1}" fill="#111"/><path d="M${cx-r*.12},${hy-r*.06} h${r*.24}" stroke="#111" stroke-width="3"/>`;
  g+=hat(o.hat,cx,hy-r*.82,r);
  if(o.umbrella) g+=`<path d="M${cx+tw+6},${ty+th*.3} V${hy-r-6}" stroke="#555" stroke-width="3"/><path d="M${cx-62},${hy-r+4} Q${cx-60},${hy-r-58} ${cx+tw+6},${hy-r-58} Q${cx+tw+72},${hy-r-58} ${cx+tw+74},${hy-r+4} Q${cx+tw+52},${hy-r-10} ${cx+tw+30},${hy-r+4} Q${cx+tw+6},${hy-r-10} ${cx-18},${hy-r+4} Q${cx-40},${hy-r-10} ${cx-62},${hy-r+4}Z" fill="#2F6FDB" opacity=".92"/>`;
  if(o.mood==="sleep") g+=`<text class="zzz" x="${cx+r*.6}" y="${hy-r*.7}" font-size="18" font-weight="900" fill="#7C89B6">Z z</text>`;
  if(o.hungry) g+=`<g><rect x="${cx-r-58}" y="${hy-r*.4}" width="62" height="26" rx="13" fill="#fff" stroke="#E3E7EF"/><text x="${cx-r-27}" y="${hy-r*.4+17}" text-anchor="middle" font-size="12" font-weight="700" fill="#E5484D">꼬르륵…</text></g>`;
  const extra=mini?"":wealth(o.pt,168,30);
  const aura=`<radialGradient id="aura"><stop offset="0" stop-color="#FFE066" stop-opacity=".9"/><stop offset="1" stop-color="#FFE066" stop-opacity="0"/></radialGradient>`;
  const d=defs(z,uid).replace("</defs>",aura+"</defs>");
  const auraG=extra.startsWith('<circle class="aura"')?extra.slice(0,extra.indexOf("/>")+2):"";
  return `<svg viewBox="0 -10 220 210" xmlns="http://www.w3.org/2000/svg">${d}${auraG}<ellipse class="shadow" cx="${cx}" cy="${fy+12}" rx="48" ry="8" fill="#000"/><g class="bob">${g}</g>${extra.replace(auraG,"")}</svg>`;
}

window.GameChars = { Z, HAT, OUT, SHO, draw: (id, o, uid, mini) => drawChar(Z.find((x) => x.id === id) || Z[2], Object.assign({ hat: 'none', outfit: 'none', shoes: 'none', pt: 0 }, o), uid, mini) };
})();
