// 南京紫峰专用构建器。几何先以米建造，最后 xyz 同比缩放至城市单体尺度。
// 450 m: CTBUH; 基底: OSM way 140809508。退台、凹槽、冠径按照片估算，非施工图尺寸。
import * as THREE from 'three';
import { toV2, vU, makeRandom, clamp } from './geo.js';
import { registerEnv, mergeStaticMeshes } from './lib.js';

export const ZIFENG_SURVEY = {
  architecturalHeight: 450,
  occupiedHeight: 316.6,
  observatoryHeight: 271.8,
  crownTop: 381, // 结构屋顶口径；冠柱本身位于此高度以下
  sources: [
    'https://www.skyscrapercenter.com/building/zifeng-tower/165',
    'https://www.smithgill.com/work/zifeng_tower/',
    'https://www.openstreetmap.org/way/140809508',
  ],
  estimated: '退台标高、幕墙模数、凹槽、冠柱直径及裙房细节按公开照片重建',
};

const MAIN = [
  [118.7781014, 32.062422], [118.7777385, 32.0627166], [118.7777183, 32.0627721],
  [118.7779384, 32.0628862], [118.7782096, 32.0629544], [118.7782587, 32.0629002],
  [118.7782337, 32.0624534], [118.7781786, 32.0624179],
];
const PODIUM = [
  [118.7772309,32.0628825],[118.7771468,32.0628171],[118.7779653,32.0621463],
  [118.7779922,32.0621749],[118.7780214,32.0622111],[118.7780327,32.0622472],
  [118.7780394,32.062293],[118.7780102,32.0623444],[118.7780282,32.0623596],
  [118.7780507,32.0623329],[118.7780664,32.0623044],[118.7780596,32.062253],
  [118.7780664,32.0622073],[118.7781014,32.062422],[118.7777385,32.0627166],
  [118.7777183,32.0627721],[118.7782096,32.0629544],[118.7782587,32.0629002],
  [118.7782691,32.0633083],[118.7782294,32.0632523],[118.7781727,32.0632555],
  [118.7781708,32.0633083],[118.7778912,32.0633131],[118.7778496,32.0632491],
  [118.7775227,32.0632427],[118.7773411,32.0631668],[118.7773103,32.0631404],
  [118.777162,32.0630128],[118.7771527,32.062989],[118.7771553,32.0629652],
  [118.7771623,32.0629402],
];
const SECONDARY = [
  [118.7773411,32.0631668],[118.7773103,32.0631404],[118.777162,32.0630128],
  [118.7771527,32.062989],[118.7771553,32.0629652],[118.7771623,32.0629402],
  [118.7772309,32.0628825],[118.7774319,32.0627071],[118.7775322,32.0630049],
];

// 主体是同一基底上两片互锁外壳包住中核，各自终止于不同高度。
// 标高是按正面/侧面照片校形的估值；不把外墙整圈分成同步收缩的台阶。
const BODY = { shoulder: 160, westInnerTop: 248, westOuterTop: 298, eastTop: 326, coreTop: 350 };

function center(poly) {
  // 面积形心；顶点密度不同不能用顶点平均当作桅杆轴线。
  let area = 0, x = 0, z = 0;
  for (let i=0; i<poly.length; i++) {
    const a=poly[i], b=poly[(i+1)%poly.length], cross=a[0]*b[1]-b[0]*a[1];
    area+=cross; x+=(a[0]+b[0])*cross; z+=(a[1]+b[1])*cross;
  }
  return [x/(3*area),z/(3*area)];
}

function rounded(poly, radius=1.4) {
  const out=[];
  for(let i=0;i<poly.length;i++) {
    const p=poly[i], a=poly[(i+poly.length-1)%poly.length], b=poly[(i+1)%poly.length];
    const r=Math.min(radius,Math.hypot(a[0]-p[0],a[1]-p[1])*.22,Math.hypot(b[0]-p[0],b[1]-p[1])*.22);
    const la=Math.hypot(a[0]-p[0],a[1]-p[1]), lb=Math.hypot(b[0]-p[0],b[1]-p[1]);
    const start=[p[0]+(a[0]-p[0])*r/la,p[1]+(a[1]-p[1])*r/la];
    const end=[p[0]+(b[0]-p[0])*r/lb,p[1]+(b[1]-p[1])*r/lb];
    for(let k=0;k<=3;k++) {
      const t=k/3,s=1-t;
      out.push([s*s*start[0]+2*s*t*p[0]+t*t*end[0],s*s*start[1]+2*s*t*p[1]+t*t*end[1]]);
    }
  }
  return out;
}

function bucket() { return { position:[], color:[] }; }
function quad(buf,a,b,c,d,color=null) {
  buf.position.push(...a,...b,...c,...a,...c,...d);
  if(color) for(const k of [0,1,2,0,2,3]) {
    const tint=Array.isArray(color)?color[k]:color;
    buf.color.push(tint.r,tint.g,tint.b);
  }
}
function meshFrom(g,buf,material,name) {
  if(!buf.position.length) return null;
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(buf.position,3));
  if(buf.color.length) geometry.setAttribute('color',new THREE.Float32BufferAttribute(buf.color,3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const m=new THREE.Mesh(geometry,material);
  m.name=name; m.castShadow=true; m.receiveShadow=true;
  // 已合批，且顶点颜色必须保留；避免 mergeStaticMeshes 丢失颜色属性。
  m.userData.noMerge=true;
  g.add(m); return m;
}
function slab(g,poly,y,h,material,name) {
  const shape=new THREE.Shape(poly.map(p=>new THREE.Vector2(p[0],-p[1])));
  const geometry=new THREE.ExtrudeGeometry(shape,{depth:h,bevelEnabled:false,steps:1});
  geometry.rotateX(-Math.PI/2); geometry.translate(0,y,0);
  const mesh=new THREE.Mesh(geometry,material);
  mesh.name=name; mesh.castShadow=true; mesh.receiveShadow=true; g.add(mesh);
  return mesh;
}
function rod(g,a,b,r,material,name='mullion') {
  const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b), delta=bv.clone().sub(av);
  const mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,delta.length(),8),material);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());
  mesh.position.copy(av).add(bv).multiplyScalar(.5); mesh.name=name; g.add(mesh); return mesh;
}
function inside(p,poly) {
  let ok=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++) {
    const a=poly[i],b=poly[j];
    if((a[1]>p[1])!==(b[1]>p[1]) && p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]) ok=!ok;
  }
  return ok;
}
function scalePlan(poly,axis,r) {
  return poly.map(p=>[axis[0]+(p[0]-axis[0])*r,axis[1]+(p[1]-axis[1])*r]);
}
function between(a,b,t) {
  return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
}
function roundedWingEdge(a,b) {
  // 长边的轻微外弧是翼面自身的曲率，不能只靠四角倒圆来表现。
  return [.2,.4,.6,.8].map(t=>{
    const p=between(a,b,t),bulge=4.0*Math.sin(Math.PI*t);
    return [p[0]+bulge,p[1]+bulge*.05];
  });
}
// 将一段翼壳的前缘退到指定平面，保留后部轮廓。
function clipBehind(poly,origin,normal,depth) {
  const distance=p=>(p[0]-origin[0])*normal[0]+(p[1]-origin[2])*normal[2]+depth;
  const out=[];
  for(let i=0;i<poly.length;i++) {
    const a=poly[i],b=poly[(i+1)%poly.length],da=distance(a),db=distance(b);
    if(da<=0)out.push(a);
    if((da<0)!==(db<0))out.push(between(a,b,da/(da-db)));
  }
  return out;
}

// 在立面的米制平面内裁切，开口边界不受错位玻璃网格影响。
function subtractOpenings(rect,openings) {
  let pieces=[rect];
  for(const hole of openings) {
    const next=[];
    for(const p of pieces) {
      const l=Math.max(p.l,hole.l),r=Math.min(p.r,hole.r);
      const b=Math.max(p.b,hole.b),t=Math.min(p.t,hole.t);
      if(l>=r||b>=t){next.push(p);continue;}
      if(p.l<l)next.push({l:p.l,r:l,b:p.b,t:p.t});
      if(r<p.r)next.push({l:r,r:p.r,b:p.b,t:p.t});
      if(p.b<b)next.push({l,r,b:p.b,t:b});
      if(t<p.t)next.push({l,r,b:t,t:p.t});
    }
    pieces=next;
  }
  return pieces;
}

export function buildZifeng(lm) {
  const g=new THREE.Group(); g.name='zifeng:metres'; g.scale.setScalar(vU(1));
  const origin=toV2(lm.lon,lm.lat);
  const local=pts=>pts.map(p=>{const q=toV2(...p);return [(q[0]-origin[0])*100,(q[1]-origin[1])*100];});
  const main=local(MAIN),podium=local(PODIUM),secondary=local(SECONDARY),axis=center(main);
  const rand=makeRandom(140809508);
  const material=(color,roughness,metalness,vertexColors=false,env=1.15)=>{
    const m=new THREE.MeshStandardMaterial({color,roughness,metalness,vertexColors,side:THREE.DoubleSide});
    registerEnv(m,env); return m;
  };
  // 白色材质底色让银青顶点色只着色一次，反射随斜置鳞片的法线变化。
  const glass=material('#ffffff',.24,.52,true,1.16), dark=material('#263d42',.48,.24);
  const metal=material('#b5bdb0',.26,.82), stone=material('#a9aaa2',.9,.04);
  const scaleMetal=material('#78877e',.34,.76);
  const roof=material('#65706e',.84,.08), green=material('#405b3f',.96,.02);
  const crown=material('#a0afa6',.3,.72);
  const lightMat=new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide});
  const glassBuf=bucket(),metalBuf=bucket(),scaleEdges=bucket(),recessBuf=bucket(),lights=bucket();
  const glassColor=new THREE.Color(),windowColor=new THREE.Color();
  const glassJade=new THREE.Color('#466f75'),glassSilver=new THREE.Color('#9bac9f');
  const paneColors=Array.from({length:4},()=>new THREE.Color());

  function edgeFrame(poly,e) {
    const a=poly[e],b=poly[(e+1)%poly.length],c=center(poly);
    const dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz),ux=dx/len,uz=dz/len;
    let nx=uz,nz=-ux;
    if(nx*(c[0]-(a[0]+b[0])/2)+nz*(c[1]-(a[1]+b[1])/2)>0){nx=-nx;nz=-nz;}
    return {len,at:(d,y,inset=0)=>[a[0]+ux*d+nx*inset,y,a[1]+uz*d+nz*inset],normal:[nx,0,nz]};
  }

  // 中上段由两翼各自收边形成一条错位竖槽，不在西翼上再挖孤立小窗。
  // 后壁按相邻高度区间拼接，248m和266m交会处不加横贯槽口的封板。
  function upperSeamInterior(f,profiles,depth=6.3) {
    const tint=new THREE.Color('#344f54');
    for(const {l,r,b,t} of profiles) {
      quad(glassBuf,f.at(l,b,-depth),f.at(r,b,-depth),f.at(r,t,-depth),f.at(l,t,-depth),tint);
      for(let y=Math.ceil(b/1.05)*1.05;y<t-.05;y+=1.05)
        quad(scaleEdges,f.at(l,y,-depth+.08),f.at(r,y,-depth+.08),f.at(r,y+.05,-depth+.08),f.at(l,y+.05,-depth+.08));
      for(let y=Math.ceil((b+.01)/4.15)*4.15;y<t;y+=4.15)
        quad(metalBuf,f.at(l,y,-depth+.05),f.at(r,y,-depth+.05),f.at(r,y+.12,-depth+.05),f.at(l,y+.12,-depth+.05));
      for(let d=Math.ceil(l/1.6)*1.6;d<r;d+=1.6)
        quad(metalBuf,f.at(d,b,-depth+.04),f.at(d+.045,b,-depth+.04),f.at(d+.045,t,-depth+.04),f.at(d,t,-depth+.04));
      for(const d of [l+.45,r-.45]) {
        // 最下段外侧随东翼斜收边退入，避免立柱悬在翼壳轮廓之外。
        const inset=d<0?-5.4:-1.7;
        rod(g,f.at(d,b,inset),f.at(d,t,inset),.13,metal,'zifeng:upper-seam-upright');
      }
      for(let y=Math.ceil((b+.1)/16.6)*16.6;y<t-.2;y+=16.6)
        rod(g,f.at(l+.4,y,-depth+.4),f.at(r-.4,y,-depth+.4),.17,metal,'zifeng:upper-seam-rear-beam');
    }
    const high=profiles[profiles.length-1];
    // 上端斜撑落在真实翼间空间内，左侧幕墙在此直接收边。
    rod(g,f.at(high.l+.7,268,-2.4),f.at(high.r-.7,281,-2.4),.14,metal,'zifeng:upper-seam-brace');
    rod(g,f.at(high.r-.7,281,-2.4),f.at(high.l+.7,295,-2.4),.14,metal,'zifeng:upper-seam-brace');
    rod(g,f.at(7.2,248,-2),f.at(7.2,266,-2),.25,metal,'zifeng:upper-seam-elbow-column');
    rod(g,f.at(-1.2,160,-2),f.at(-1.2,178,-2),.25,metal,'zifeng:upper-seam-foot-column');
    g.userData.upperSeam={origin:f.at(0,0),normal:f.normal,
      tangent:[-f.normal[2],0,f.normal[0]],depth,profiles};
  }

  // 用户圈出的低段是连续倒L凹槽：宽正面上方的横带，转入右端竖槽。
  // d=0 位于正面右端(main[0])，d增加向左；竖槽直达裙房屋面。
  // 两个裁切矩形共享同一后壁，在交会处不添加封口、楼板或独立门框。
  function lowerFacadeSeam(poly,podiumTop) {
    const edge=3,f=edgeFrame(poly,edge),depth=6,strip=9.5;
    const bottom=podiumTop,elbow=106,top=118,l=0,r=f.len;
    const holes=[
      {edge,l,r,b:elbow,t:top},
      {edge,l,r:strip,b:bottom,t:elbow},
    ];
    const rearTint=new THREE.Color('#344f54');
    for(const h of holes) {
      quad(glassBuf,f.at(h.l,h.b,-depth),f.at(h.r,h.b,-depth),
        f.at(h.r,h.t,-depth),f.at(h.l,h.t,-depth),rearTint);
      // 后退玻璃仍有细密层线，不使用实心黑色面或贴在洞口的夜窗。
      for(let y=Math.ceil((h.b+.01)/4.15)*4.15;y<h.t;y+=4.15)
        quad(metalBuf,f.at(h.l,y,-depth+.03),f.at(h.r,y,-depth+.03),
          f.at(h.r,y+.10,-depth+.03),f.at(h.l,y+.10,-depth+.03));
      for(let d=h.l+1.6;d<h.r;d+=1.6)
        quad(metalBuf,f.at(d,h.b,-depth+.03),f.at(d+.045,h.b,-depth+.03),
          f.at(d+.045,h.t,-depth+.03),f.at(d,h.t,-depth+.03));
      for(let y=Math.ceil(h.b/1.05)*1.05;y<h.t-.05;y+=1.05)
        quad(scaleEdges,f.at(h.l,y,-depth+.08),f.at(h.r,y,-depth+.08),
          f.at(h.r,y+.05,-depth+.08),f.at(h.l,y+.05,-depth+.08));
    }
    const shelf=(a,b,y,thickness,name)=>{
      const p=[f.at(a,0),f.at(b,0),f.at(b,0,-depth),f.at(a,0,-depth)].map(v=>[v[0],v[2]]);
      slab(g,p,y,thickness,metal,`zifeng:lower-L-${name}`);
    };
    const jamb=(d,b,t)=>{
      // 深槽两侧沿体块边界折入，窄金属收边包住后退侧壁。
      const p=[f.at(d-.10,0),f.at(d+.10,0),f.at(d+.10,0,-depth),f.at(d-.10,0,-depth)].map(v=>[v[0],v[2]]);
      slab(g,p,b,t-b,metal,'zifeng:lower-L-return');
    };
    shelf(l,r,top,.35,'cap-soffit');
    shelf(strip,r,elbow-.3,.3,'lower-shell-top');
    shelf(l,strip,bottom,.25,'podium-landing');
    jamb(l,bottom,top);
    jamb(r,elbow,top);
    jamb(strip,bottom,elbow);
    // 横带中只露出承重柱；右侧立柱与纵向梁线连续下行。
    for(const d of [strip,strip+(r-strip)/3,strip+2*(r-strip)/3])
      rod(g,f.at(d,elbow,-1.0),f.at(d,top,-1.0),.28,metal,'zifeng:lower-L-column');
    for(const d of [l+.55,strip-.45])
      rod(g,f.at(d,bottom,-1.1),f.at(d,top,-1.1),.16,metal,'zifeng:lower-L-vertical-frame');
    // 后方楼板梁不横封洞口，保留从横带到裙房的连续进深。
    for(let y=bottom+8.3;y<top-1;y+=8.3)
      rod(g,f.at(l+.45,y,-depth+.4),f.at(strip-.45,y,-depth+.4),.11,metal,'zifeng:lower-L-rear-beam');
    const diagonalBottom=bottom+1.8,diagonalTop=bottom+10.5;
    rod(g,f.at(l+.6,diagonalBottom,-2.4),f.at(strip-.6,diagonalTop,-2.4),.13,metal,'zifeng:lower-L-low-brace');
    const warm=new THREE.Color('#ead8b9').multiplyScalar(.48);
    quad(lights,f.at(l,top-.2,-2),f.at(r,top-.2,-2),f.at(r,top-.2,-2.15),f.at(l,top-.2,-2.15),warm);
    g.userData.lowerSeam={edge,depth,strip,bottom,elbow,top,width:r,
      origin:f.at(0,0),normal:f.normal,tangent:[-f.normal[2],0,f.normal[0]]};
    return holes;
  }

  function facade(poly,y0,y1,{floor=4.15,module=1.5,occupancy=.37,tone=1,scaleStrength=1,openings=[]}={}) {
    const c=center(poly);
    // 阶段起止处截断楼层与鳞片，避免窗板跨过退台浮在空中。
    const levels=[y0];
    for(let y=Math.ceil((y0+.001)/floor)*floor;y<y1-.001;y+=floor) levels.push(y);
    levels.push(y1);
    for(let row=0;row<levels.length-1;row++) {
      const lo=levels[row],hi=levels[row+1],ym=(lo+hi)/2, rowId=Math.floor(ym/floor);
      const litP=occupancy*(.6+rand()*.8),scaleRow=Math.floor(rowId/2);
      const scalePhase=y=>clamp((y-scaleRow*floor*2)/(floor*2),0,1);
      for(let e=0;e<poly.length;e++) {
        const a=poly[e],b=poly[(e+1)%poly.length],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);
        const ux=dx/len,uz=dz/len;
        let nx=uz,nz=-ux;
        if(nx*(c[0]-(a[0]+b[0])/2)+nz*(c[1]-(a[1]+b[1])/2)>0){nx=-nx;nz=-nz;}
        const at=(d,y,inset=0)=>[a[0]+ux*d+nx*inset,y,a[1]+uz*d+nz*inset];
        const cuts=openings.filter(h=>h.edge===e&&h.b<hi&&h.t>lo);
        // 中庭同时切开外皮和内衬，避免开口内仍有1.3m处的整块暗面。
        for(const p of subtractOpenings({l:0,r:len,b:lo,t:hi},cuts))
          quad(recessBuf,at(p.l,p.b,-1.3),at(p.r,p.b,-1.3),at(p.r,p.t,-1.3),at(p.l,p.t,-1.3));
        const start=(Math.floor(rowId/2)%2)*module*.5;
        for(let s=-start;s<len-.01;s+=module) {
          for(const part of subtractOpenings({l:Math.max(0,s),r:Math.min(len,s+module),b:lo,t:hi},cuts)) {
          const d0=part.l,d1=part.r;
          if(d1-d0<.06) continue;
          const left=d0+.035,right=d1-.035;
          const bottom=part.b+(rowId%2===0?.105:.055),top=part.t-.045;
          if(top<=bottom) continue;
          const column=Math.floor(s/module),rhythm=Math.sin(column*1.7+scaleRow*.7+e*.31);
          const tilt=(len>8?.31+.04*rhythm:.055)*scaleStrength;
          // 原始单元相位用于边角裁切，半块玻璃仍与完整鳞片共面。
          // 下沿微翘，上沿内收；两层连续，组与组错半模形成搭接。
          const paneAt=(d,y,offset=0)=>at(d,y,
            .025+tilt*clamp((d-s)/module,0,1)+.035*scaleStrength*(1-scalePhase(y))+offset);
          glassColor.copy(glassJade).lerp(glassSilver,
            .42+.16*clamp(ym/350,0,1)+.075*rhythm).multiplyScalar(tone*(.985+rand()*.03));
          const corners=[[left,bottom],[right,bottom],[right,top],[left,top]];
          for(let k=0;k<4;k++) {
            const [d,y]=corners[k],u=clamp((d-s)/module,0,1);
            paneColors[k].copy(glassColor).multiplyScalar(
              1+scaleStrength*(.07-.14*scalePhase(y)+.34*(u-.5)));
          }
          quad(glassBuf,paneAt(left,bottom),paneAt(right,bottom),paneAt(right,top),paneAt(left,top),paneColors);
          // 薄银色下唇与右侧折边沿斜面闭合，让每片鳞片有真实反光边。
          quad(metalBuf,paneAt(d0,part.b),paneAt(d1,part.b),paneAt(d1,bottom),paneAt(d0,bottom));
          quad(scaleEdges,paneAt(right,bottom),at(d1,bottom,.025),at(d1,top,.025),paneAt(right,top));
          if(rand()<litP && ym<316.6 && top-bottom>.6) {
            windowColor.set(rand()<.78?'#ffd1a1':'#c0d8e5').multiplyScalar(.35+rand()*.7);
            const q=.2*(right-left);
            quad(lights,paneAt(left+q,bottom+.3,.015),paneAt(right-q,bottom+.3,.015),
              paneAt(right-q,top-.2,.015),paneAt(left+q,top-.2,.015),windowColor);
          }
          }
        }
      }
    }
  }

  const base=rounded(main,1.25);
  // OSM 点 0→1 是宽直翼，5→6 是圆角窄翼；由 0 和 3→4 之间的分割点划开。
  // 两翼共同围绕内核，却不在相同楼层退台。
  const splitA=main[0],splitB=[
    main[3][0]*.65+main[4][0]*.35,
    main[3][1]*.65+main[4][1]*.35,
  ];
  const frontFrame=edgeFrame(main,0);
  const seamPoint=(d,depth=0)=>{const p=frontFrame.at(d,0,-depth);return [p[0],p[2]];};
  // 翼间侧壁先直退8m，再转向内核；旧斜闭合面会在槽口前方把空间封住。
  const westRaw=[seamPoint(7.8),main[1],main[2],main[3],splitB,seamPoint(7.8,8)];
  const eastTail=[splitB,main[4],main[5],...roundedWingEdge(main[5],main[6]),main[6],main[7]];
  const westInnerPlan=rounded(scalePlan(westRaw,axis,.965),1.35);
  // 右半幅的内侧幕墙先终止；靠外边线的窄幅继续升高，不形成整圈退台。
  const westOuterA=between(splitA,main[1],.31);
  const westOuterB=between(splitB,main[3],.65);
  const westOuterRaw=[westOuterA,main[1],main[2],main[3],westOuterB,seamPoint(frontFrame.len*.31,8)];
  const westOuterPlan=rounded(scalePlan(westOuterRaw,axis,.965),1.35);
  const eastPlan=rounded([seamPoint(0),seamPoint(0,8),...eastTail],2.4);
  // 东翼上段向西展开，在266m处形成第二次横向错位及悬挑底面。
  const eastUpperPlan=rounded([seamPoint(7.2),seamPoint(7.2,8),...eastTail],2.4);
  const eastFootPlan=clipBehind(eastPlan,frontFrame.at(0,0),frontFrame.normal,6.3);
  const corePlan=rounded(scalePlan(main,axis,.52),2.0);
  // 160m 大肩：下段占满地理轮廓；宽翼上段略退，东侧竖边保持连续。
  const lowerSeam=lowerFacadeSeam(base,lm.params.podium);
  facade(base,0,BODY.shoulder,{tone:.86,module:2.45,scaleStrength:.85,openings:lowerSeam});
  slab(g,base,BODY.shoulder-.24,.24,roof,'zifeng:lower-shoulder');
  // 内核从底部连续穿至350m；中段较暗，深槽内能看到它的外壁。
  facade(corePlan,0,BODY.coreTop,{tone:.82,module:2.25,scaleStrength:.65});
  upperSeamInterior(frontFrame,[
    {l:-5.5,r:8.4,b:160,t:178},
    {l:0,r:8.4,b:178,t:248},
    {l:0,r:15.0,b:248,t:266},
    {l:7.2,r:15.0,b:266,t:298},
  ]);
  // 以整片翼壳的边界留出槽口；各段后壁连续，横向拐折由两翼错高产生。
  facade(westInnerPlan,BODY.shoulder,BODY.westInnerTop,{tone:1.09,module:1.85});
  facade(westOuterPlan,BODY.westInnerTop,BODY.westOuterTop,{tone:1.12,module:1.85});
  facade(eastFootPlan,BODY.shoulder,178,{tone:.82,module:1.85,scaleStrength:.25});
  facade(eastPlan,178,266,{tone:1.13,module:1.85});
  facade(eastUpperPlan,266,BODY.eastTop,{tone:1.13,module:1.85});
  slab(g,eastPlan,178-.3,.3,metal,'zifeng:east-wing-foot-soffit');
  slab(g,eastUpperPlan,266-.3,.3,metal,'zifeng:east-wing-offset-soffit');
  // 只封各自结束的外壳顶面，不画贯穿全楼的连续层层“帽檐”。
  slab(g,westInnerPlan,BODY.westInnerTop-.25,.25,roof,'zifeng:west-inner-roof');
  slab(g,westOuterPlan,BODY.westOuterTop-.25,.25,roof,'zifeng:west-outer-roof');
  slab(g,eastUpperPlan,BODY.eastTop-.25,.25,roof,'zifeng:east-wing-roof');
  slab(g,corePlan,BODY.coreTop-.24,.24,roof,'zifeng:core-roof');

  // 裙房、副楼使用原始地理轮廓与同一米制尺度，配平顶、横向分缝和入口。
  const podiumH=lm.params.podium,secH=lm.params.secondary;
  facade(podium,0,podiumH,{floor:5.8,module:2.8,occupancy:.19,scaleStrength:.25});
  slab(g,podium,podiumH-.45,.45,stone,'zifeng:podium-roof');
  facade(secondary,podiumH,secH,{floor:4.15,module:1.7,occupancy:.3,scaleStrength:.45});
  slab(g,secondary,secH-.6,.6,roof,'zifeng:secondary-roof');
  facade(secondary,secH-1.1,secH,{floor:1.1,module:3,occupancy:0});

  // 屋顶种植只落在屋面露出区域，避开主/副楼，不再给整片楼顶铺荧光绿盖子。
  const minX=Math.min(...podium.map(p=>p[0])),maxX=Math.max(...podium.map(p=>p[0]));
  const minZ=Math.min(...podium.map(p=>p[1])),maxZ=Math.max(...podium.map(p=>p[1]));
  let gardens=0;
  for(let k=0;k<220&&gardens<18;k++) {
    const x=minX+rand()*(maxX-minX),z=minZ+rand()*(maxZ-minZ);
    const patch=[[x-2,z-1.2],[x+2,z-1.2],[x+2,z+1.2],[x-2,z+1.2]];
    if(!patch.every(p=>inside(p,podium)&&!inside(p,main)&&!inside(p,secondary))) continue;
    slab(g,patch,podiumH,.42,stone,'zifeng:planter');
    slab(g,patch,podiumH+.42,.25,green,'zifeng:roof-planting');gardens++;
  }
  // 中央路一侧入口雨篷，以主楼南端节点为基准。
  const entry=main[0];
  slab(g,[[entry[0]-9,entry[1]+.4],[entry[0]+9,entry[1]+.4],[entry[0]+9,entry[1]+7],[entry[0]-9,entry[1]+7]],
    6.0,.32,metal,'zifeng:entrance-canopy');
  for(const dx of [-7,7]) rod(g,[entry[0]+dx,0,entry[1]+5.5],[entry[0]+dx,6,entry[1]+5.5],.2,metal);

  // 柱状设备冠 + 细钢桅杆。与主楼同轴，381 m是冠顶，不是锥形帽的底座。
  const crownBase=346,crownR=5.65,crownTop=ZIFENG_SURVEY.crownTop;
  const cylinder=(r0,r1,y0,y1,mat,name)=>{
    const mesh=new THREE.Mesh(new THREE.CylinderGeometry(r1,r0,y1-y0,48),mat);
    mesh.position.set(axis[0],(y0+y1)/2,axis[1]);mesh.name=name;mesh.castShadow=true;g.add(mesh);return mesh;
  };
  cylinder(crownR,crownR,150,crownBase,crown,'zifeng:continuous-rounded-spine');
  cylinder(crownR,crownR,crownBase,crownTop-1.3,crown,'zifeng:crown-drum');
  cylinder(crownR,crownR-.6,crownTop-1.3,crownTop,crown,'zifeng:crown-rounded-rim');
  for(let y=crownBase+.8;y<crownTop-1;y+=1.55) {
    const ring=new THREE.Mesh(new THREE.TorusGeometry(crownR+.045,.06,4,48),metal);
    ring.rotation.x=Math.PI/2;ring.position.set(axis[0],y,axis[1]);g.add(ring);
  }
  for(let i=0;i<16;i++) {
    const a=i*Math.PI/8,x=axis[0]+Math.cos(a)*(crownR+.045),z=axis[1]+Math.sin(a)*(crownR+.045);
    rod(g,[x,crownBase,z],[x,crownTop-1.3,z],.055,metal);
  }
  cylinder(1.15,.96,379,417,crown,'zifeng:mast-lower');
  cylinder(.96,.65,417,438,crown,'zifeng:mast-middle');
  cylinder(.65,.23,438,450,crown,'zifeng:mast-tip');
  // 钢桅杆外壳斜撑，用直线段合批，细节清晰且无需数万三角形管线。
  for(let y=383;y<438;y+=3) {
    const radius=y<417?1.18:.96;
    for(let side=0;side<4;side++) {
      const a=side*Math.PI/2,b=a+Math.PI/2;
      rod(g,[axis[0]+Math.cos(a)*radius,y,axis[1]+Math.sin(a)*radius],
        [axis[0]+Math.cos(b)*radius,Math.min(y+3,438),axis[1]+Math.sin(b)*radius],.07,metal);
    }
  }

  meshFrom(g,recessBuf,dark,'zifeng:recessed-inner-skin');
  meshFrom(g,glassBuf,glass,'zifeng:staggered-glass');
  meshFrom(g,metalBuf,metal,'zifeng:facade-mullions');
  meshFrom(g,scaleEdges,scaleMetal,'zifeng:scale-metal-returns');
  const windows=meshFrom(g,lights,lightMat,'zifeng:night-windows');
  windows.castShadow=false;windows.receiveShadow=false;windows.visible=false;

  const beaconMat=new THREE.MeshBasicMaterial({color:'#ff3427',transparent:true,opacity:0});
  const beacon=new THREE.Mesh(new THREE.SphereGeometry(.28,10,8),beaconMat);
  beacon.name='zifeng:aviation-beacon';beacon.position.set(axis[0],449.72,axis[1]);
  beacon.userData.beacon=true;beacon.userData.noMerge=true;g.add(beacon);
  let night=0;
  g.userData.setNight=k=>{
    night=clamp(k,0,1);windows.visible=night>.001;lightMat.opacity=night;
    crown.emissive.set('#c5dbd2');crown.emissiveIntensity=night*.6;
    beaconMat.opacity=night;
  };
  g.userData.tick=t=>{const phase=t%2;beaconMat.opacity=night*((phase<.12||phase>.3&&phase<.43)?1:.1);};
  g.userData.beacon=beacon;g.userData.refTop=vU(ZIFENG_SURVEY.architecturalHeight);
  g.userData.survey={...ZIFENG_SURVEY,axisMetres:axis,unitsPerMetre:vU(1),footprintMetres:main};
  // 预览与主城均只保留少量批次。动态灯具和顶点色幕墙显式排除。
  const originals=new Set();
  g.traverse(o=>{if(o.isMesh&&!o.userData.noMerge) originals.add(o.geometry);});
  g.userData.batching=mergeStaticMeshes(g,new Set([beacon]));
  for(const geometry of originals) geometry.dispose();
  g.userData.setNight(0);
  return g;
}
