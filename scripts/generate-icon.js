const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const size = 256, scale = 3;
const pixels = Buffer.alloc(size * size * 4);
const diamond = [[64, 7.5], [120.5, 64], [64, 120.5], [7.5, 64]];
const zShape = [[42,43],[90,43],[90,54],[61,76],[90,76],[90,87],[38,87],[38,76],[67,54],[42,54]];
const color = [198, 187, 190];

function insideRoundRect(x, y, l, t, r, b, radius) {
  const cx = Math.max(l + radius, Math.min(x, r - radius));
  const cy = Math.max(t + radius, Math.min(y, b - radius));
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}
function segmentDistance(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const q = Math.max(0, Math.min(1, ((x-a[0])*dx + (y-a[1])*dy) / (dx*dx + dy*dy)));
  return Math.hypot(x - (a[0] + q*dx), y - (a[1] + q*dy));
}
function insidePolygon(x,y,poly) {
  let hit=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const a=poly[i],b=poly[j];
    if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;
  }
  return hit;
}
function sample(x, y) {
  if (!insideRoundRect(x,y,1.5,1.5,126.5,126.5,29)) return null;
  if (insideRoundRect(x,y,2.5,2.5,125.5,125.5,28) && !insideRoundRect(x,y,4,4,124,124,26)) return [42,37,40];
  if (insidePolygon(x,y,zShape)) return color;
  for (let i=0;i<diamond.length;i++) if (segmentDistance(x,y,diamond[i],diamond[(i+1)%diamond.length])<4) return color;
  if (Math.hypot(x-101,y-27)<4) return color;
  return [13,13,16];
}
for (let y=0;y<size;y++) for(let x=0;x<size;x++) {
  const sums=[0,0,0,0];
  for(let sy=0;sy<scale;sy++) for(let sx=0;sx<scale;sx++) {
    const c=sample((x+(sx+.5)/scale)/2,(y+(sy+.5)/scale)/2);
    if(c){sums[0]+=c[0];sums[1]+=c[1];sums[2]+=c[2];sums[3]+=255;}
  }
  const at=(y*size+x)*4, n=scale*scale;
  pixels[at]=Math.round(sums[0]/n);pixels[at+1]=Math.round(sums[1]/n);pixels[at+2]=Math.round(sums[2]/n);pixels[at+3]=Math.round(sums[3]/n);
}
function crc32(data) {
  let c=0xffffffff;
  for(const byte of data){c^=byte;for(let k=0;k<8;k++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);}
  return (c^0xffffffff)>>>0;
}
function chunk(type,data) {
  const name=Buffer.from(type), length=Buffer.alloc(4), crc=Buffer.alloc(4);
  length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));
  return Buffer.concat([length,name,data,crc]);
}
const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
const rows=Buffer.alloc((size*4+1)*size);
for(let y=0;y<size;y++)pixels.copy(rows,y*(size*4+1)+1,y*size*4,(y+1)*size*4);
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
const icoHeader=Buffer.alloc(6);icoHeader.writeUInt16LE(0,0);icoHeader.writeUInt16LE(1,2);icoHeader.writeUInt16LE(1,4);
const entry=Buffer.alloc(16);entry[0]=0;entry[1]=0;entry[2]=0;entry[3]=0;entry.writeUInt16LE(1,4);entry.writeUInt16LE(32,6);entry.writeUInt32LE(png.length,8);entry.writeUInt32LE(22,12);
const assets=path.join(__dirname,'..','assets');
fs.writeFileSync(path.join(assets,'zentrap-icon.png'),png);
fs.writeFileSync(path.join(assets,'zentrap-icon.ico'),Buffer.concat([icoHeader,entry,png]));
