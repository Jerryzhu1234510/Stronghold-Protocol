export function versusCameraOptions({width,side='L',overview=false,rect,hudTop=0}) {
  const phone=width<=1000;
  return {rect:{...rect,r0:0},side,half:!overview,instant:true,shop:false,fit:true,
    margin:phone&&!overview ? .08 : .3,headroom:phone&&!overview ? 1.4 : .65,
    minTilePx:phone&&!overview?36:undefined,maxTilePx:phone&&!overview?60:undefined,
    alignTop:phone&&!overview,benchInset:!overview||hudTop>0?12:undefined,
    benchHeadroom:phone&&!overview||hudTop>0?1.5:undefined,benchHudTop:Math.max(4,hudTop),
    padding:{left:phone?76:146,right:phone?4:8,top:Math.max(phone&&!overview?32:43,hudTop),bottom:12}};
}
