// Geometry regressions: exact tip, uniform units, mast alignment, deterministic
// facade, and the same merge/night path used by the city (no browser required).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { buildZifeng } from '../js/zifeng.js';
import { LANDMARKS } from '../js/data.js';
import { mergeStaticMeshes } from '../js/lib.js';

const lm=LANDMARKS.find(l=>l.id==='zifeng');
const model=buildZifeng(lm);
function points(root) {
  const output=[],v=new THREE.Vector3();root.updateWorldMatrix(true,true);
  root.traverse(o=>{
    if(!o.isMesh)return;
    const p=o.geometry.attributes.position;
    for(let i=0;i<p.count;i++) {
      v.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld).multiplyScalar(30);
      assert.ok(Number.isFinite(v.x)&&Number.isFinite(v.y)&&Number.isFinite(v.z),'finite geometry');
      output.push(v.clone());
    }
  });return output;
}
function bounds(pts) {return new THREE.Box3().setFromPoints(pts);}
function signature(root) {
  const hash=createHash('sha256');
  root.traverse(o=>{
    if(!o.isMesh)return;
    for(const key of ['position','color']) {
      const a=o.geometry.attributes[key]?.array;
      if(a)hash.update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength));
    }
    hash.update(JSON.stringify(o.position.toArray()));
  });return hash.digest('hex');
}
const all=points(model),box=bounds(all);
assert.ok(Math.abs(box.max.y-450)<.001,'tip is 450m including beacon');
assert.ok(Math.abs(box.min.y)<.001,'base touches ground');
const facade=model.getObjectByName('zifeng:staggered-glass');
const body=bounds(all.filter(v=>v.y>180&&v.y<200));
// Independent bounds from the OSM plan: 51.026m E-W, 59.492m N-S.
assert.ok(Math.abs(body.max.x-body.min.x-51.026)<2,'east-west footprint remains metre-scale');
assert.ok(Math.abs(body.max.z-body.min.z-59.492)<2,'north-south footprint remains metre-scale');
const upper=bounds(all.filter(v=>v.y>307&&v.y<319));
assert.ok(upper.max.x-upper.min.x<body.max.x-body.min.x,'upper body has actual setbacks');
const shaft=bounds(all.filter(v=>v.y>441));
const beacon=new THREE.Vector3();model.userData.beacon.getWorldPosition(beacon).multiplyScalar(30);
assert.ok(Math.abs((shaft.min.x+shaft.max.x)/2-beacon.x)<.01,'mast and beacon share X axis');
assert.ok(Math.abs((shaft.min.z+shaft.max.z)/2-beacon.z)<.01,'mast and beacon share Z axis');
// The mast used to be at the landmark origin, ~25m away from the tower.
assert.ok(Math.abs(beacon.x+1.0972)<.01 && Math.abs(beacon.z+25.4391)<.01,'mast on footprint area centroid');
const crown=bounds(all.filter(v=>v.y>356&&v.y<374));
assert.ok(crown.max.x-crown.min.x>10&&crown.max.x-crown.min.x<12,'cylindrical crown, not conical spike');
assert.ok(facade.geometry.attributes.color.count===facade.geometry.attributes.position.count);

// The lower recess must be one continuous inverted L, with a real rear wall.
// Probe its volume instead of checking the generated triangle arrangement.
const seam=model.userData.lowerSeam;
assert.ok(seam,'lower facade exposes its review frame');
const seamOrigin=new THREE.Vector3(...seam.origin);
const seamNormal=new THREE.Vector3(...seam.normal);
const seamTangent=new THREE.Vector3(...seam.tangent);
const seamPoint=(d,y,inset=0)=>model.localToWorld(seamOrigin.clone()
  .addScaledVector(seamTangent,d).addScaledVector(seamNormal,inset).add(new THREE.Vector3(0,y,0)));
const solidMeshes=[];
model.traverseVisible(o=>{
  if(!o.isMesh||o.userData.beacon||o.name==='zifeng:night-windows')return;
  const materials=Array.isArray(o.material)?o.material:[o.material];
  if(materials.some(m=>m.visible&&(!m.transparent||m.opacity>.001)))solidMeshes.push(o);
});
function seamRay(a,b) {
  const delta=b.clone().sub(a),length=delta.length();
  return new THREE.Raycaster(a,delta.normalize(),.00001,length).intersectObjects(solidMeshes,false);
}
function recessDepth(d,y,label) {
  const hits=seamRay(seamPoint(d,y,2),seamPoint(d,y,-seam.depth-.2));
  assert.ok(hits.length,`${label}: recess has an opaque rear wall`);
  const local=model.worldToLocal(hits[0].point.clone());
  return -local.sub(seamOrigin).dot(seamNormal);
}
for(const [d,y,label] of [
  [seam.strip*.43,seam.bottom+17.8,'lower vertical recess'],
  [seam.strip+(seam.width-seam.strip)*.18,seam.elbow+5.3,'horizontal recess'],
  [seam.strip*.43,seam.elbow+.8,'recess elbow'],
]) {
  const depth=recessDepth(d,y,label);
  assert.ok(Math.abs(depth-6)<.08,`${label}: first solid surface is 6m behind facade, got ${depth.toFixed(3)}m`);
}
for(const [d,y,label] of [
  [seam.strip+2.3,(seam.bottom+seam.elbow)/2+.3,'wall beside vertical recess'],
  [seam.width*.54,seam.top+4.6,'wall above horizontal recess'],
  [seam.strip+3.6,seam.elbow-4.4,'wall below horizontal recess'],
]) {
  const depth=recessDepth(d,y,label);
  assert.ok(depth>-.5&&depth<.12,`${label}: neighbouring curtain wall remains at facade, got ${depth.toFixed(3)}m`);
}
for(const [a,b,label] of [
  [seamPoint(seam.strip*.43,seam.elbow-3,-3),seamPoint(seam.strip*.43,seam.elbow+3,-3),'vertical passage through elbow'],
  [seamPoint(seam.strip*.5,seam.elbow-2,-3),seamPoint(seam.strip+3,seam.elbow+4,-3),'diagonal passage into horizontal recess'],
]) {
  const hits=seamRay(a,b);
  assert.equal(hits.length,0,`${label}: no internal shelf or jamb seals the L junction`);
}

// Upper wing boundaries form a connected, offset slot. Probes deliberately
// avoid visible columns, braces and rear beams, so a shallow self-closing wall
// cannot masquerade as the intended recessed glazing.
const upperSeam=model.userData.upperSeam;
assert.ok(upperSeam,'upper facade exposes its review frame');
const upperOrigin=new THREE.Vector3(...upperSeam.origin);
const upperNormal=new THREE.Vector3(...upperSeam.normal);
const upperTangent=new THREE.Vector3(...upperSeam.tangent);
const upperPoint=(d,y,inset=0)=>model.localToWorld(upperOrigin.clone()
  .addScaledVector(upperTangent,d).addScaledVector(upperNormal,inset).add(new THREE.Vector3(0,y,0)));
function upperDepth(d,y,label) {
  const hits=seamRay(upperPoint(d,y,2),upperPoint(d,y,-upperSeam.depth-.2));
  assert.ok(hits.length,`${label} at d=${d}m, y=${y}m: missing solid backing`);
  return -model.worldToLocal(hits[0].point.clone()).sub(upperOrigin).dot(upperNormal);
}
for(const [d,y,label] of [
  [1.45,168.35,'recessed wing foot'],
  [4.2,181.35,'slot above wing foot'],
  [4.2,203.35,'long lower slot'],
  [4.2,245.35,'slot below west setback'],
  [11.5,255.35,'wide offset junction'],
  [11.1,271.35,'slot above east overhang'],
  [11.1,286.35,'upper slot'],
  [11.1,294.35,'slot below west wing roof'],
]) {
  const depth=upperDepth(d,y,label);
  assert.ok(Math.abs(depth-6.3)<.1,
    `${label} at d=${d}m, y=${y}m: first solid surface must be 6.3m behind facade, got ${depth.toFixed(3)}m`);
}
for(const [d,y,label] of [
  [11.4,203.9,'west inner wing'],[-3,203.9,'east middle wing'],
  [18,255.35,'west outer wing'],[-3,255.35,'east wing beside wide junction'],
  [18,286.9,'west upper wing'],[4.2,286.9,'east upper wing overhang'],
]) {
  const depth=upperDepth(d,y,label);
  assert.ok(depth>-.5&&depth<3,
    `${label} at d=${d}m, y=${y}m: adjacent wing shell must remain in front of slot backing, got ${depth.toFixed(3)}m`);
}
for(const [a,b,label] of [
  [[4.2,175,-3],[4.2,181,-3],'178m foot connection'],
  [[4.2,245,-3],[4.2,251,-3],'248m west setback connection'],
  [[4.2,246,-3],[10.5,252,-3],'248m widening of slot'],
  [[11.1,263,-3],[11.1,269,-3],'266m east overhang connection'],
  [[4.2,261,-3],[11.1,269,-3],'266m sideways passage'],
]) {
  const hits=seamRay(upperPoint(...a),upperPoint(...b));
  assert.equal(hits.length,0,
    `${label}: ray ${a.join(',')} -> ${b.join(',')} must not meet a roof, soffit or inner closure`);
}

const other=buildZifeng(lm);
assert.equal(signature(model),signature(other),'rebuilding preserves pane and window placement');
const windows=model.getObjectByName('zifeng:night-windows');
model.userData.setNight(1);model.userData.tick(.05);
assert.equal(windows.visible,true);assert.equal(windows.material.opacity,1);
assert.equal(other.getObjectByName('zifeng:night-windows').visible,false,'lighting is instance-local');

// Reproduce the city wrapper and animated-object selection.
const city=new THREE.Group();city.add(model);city.position.set(12,2,-7);
const keep=new Set();model.traverse(o=>{if(o.userData.boat||o.userData.beacon)keep.add(o);});
mergeStaticMeshes(city,keep);
assert.equal(model.getObjectByName('zifeng:staggered-glass'),facade,'vertex colour facade survives city batching');
model.userData.setNight(0);model.userData.tick(1);
assert.equal(windows.visible,false);assert.equal(windows.material.opacity,0);
assert.equal(model.userData.beacon.material.opacity,0);
let meshes=0,triangles=0;model.traverse(o=>{if(o.isMesh){meshes++;triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;}});
assert.ok(meshes<=12,'static crown and podium are batched');
assert.ok(triangles<160000,'facade stays within geometry budget');
console.log(`紫峰几何通过：最高点 ${box.max.y.toFixed(3)}m，基底约 ${(body.max.x-body.min.x).toFixed(2)}×${(body.max.z-body.min.z).toFixed(2)}m，同轴/等比/倒L凹槽/上部连续错位槽/确定性/日夜/合批通过；${meshes} meshes，${triangles} triangles。`);
