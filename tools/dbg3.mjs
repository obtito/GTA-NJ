import * as arch from '../js/arch.js';
import * as THREE from 'three';
function maxY(o){const v=new THREE.Vector3();let m=-Infinity;o.updateWorldMatrix(true,true);
  o.traverse(c=>{if(!c.isMesh)return;const a=c.geometry&&c.geometry.attributes&&c.geometry.attributes.position;if(!a)return;
    for(let i=0;i<a.count;i++){v.fromBufferAttribute(a,i).applyMatrix4(c.matrixWorld);if(v.y>m)m=v.y;}});return m;}
for(const rt of ['hip','gable-hip','gable']){
  const h=arch.chineseHall({w:1.13,d:0.8,pedestalH:0.04,bodyH:0.3,roofRise:0.2,bays:5,depthBays:3,roofType:rt});
  console.log(rt.padEnd(11),'maxY=',maxY(h).toFixed(3),'(budget 0.54)');
}
// also test bare gableHipRoof
const gr=arch.gableHipRoof({w:1.47,d:1.04,rise:0.2,ridgeLen:1.47*0.42});
console.log('gableHipRoof alone maxY=',maxY(gr).toFixed(3));
const hr=arch.hipRoof({w:1.47,d:1.04,rise:0.2});
console.log('hipRoof alone maxY=',maxY(hr).toFixed(3));
