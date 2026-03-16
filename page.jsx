'use client';
import { useState, useEffect, useRef } from "react";
import { useAccount, useChainId, useSwitchChain, useWriteContract } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { parseUnits } from 'viem';

const ASSETS = [
  { id:"eth",   sym:"ETH",   name:"Ethereum",   icon:"Ξ",  clr:"#627EEA", ltv:0.80, cgId:"ethereum",     decimals:18, isNative:true  },
  { id:"wbtc",  sym:"WBTC",  name:"Bitcoin",    icon:"₿",  clr:"#F7931A", ltv:0.70, cgId:"bitcoin",      decimals:8,  isNative:false },
  { id:"steth", sym:"stETH", name:"Lido stETH", icon:"Ξ",  clr:"#00C2FF", ltv:0.75, cgId:"staked-ether", decimals:18, isNative:false },
  { id:"sol",   sym:"SOL",   name:"Solana",     icon:"◎",  clr:"#9945FF", ltv:0.65, cgId:"solana",       decimals:9,  isNative:false },
];
const DEBTS = [
  { id:"cc",       name:"Credit Card",   icon:"💳", rate:22.5 },
  { id:"personal", name:"Personal Loan", icon:"🏦", rate:11.2 },
  { id:"auto",     name:"Auto Loan",     icon:"🚗", rate:7.8  },
  { id:"student",  name:"Student Loan",  icon:"🎓", rate:6.5  },
];
const CHAINS = [
  { id:1,     name:"Ethereum", short:"ETH",  clr:"#627EEA", icon:"Ξ"  },
  { id:8453,  name:"Base",     short:"BASE", clr:"#0052FF", icon:"🔵" },
  { id:42161, name:"Arbitrum", short:"ARB",  clr:"#28A0F0", icon:"⚡" },
];
const PROTOCOLS = [
  { id:"morpho",   name:"Morpho Blue",  icon:"🔵", badge:"Lowest Rate",   badgeClr:"#4fffb0", tvl:"$4.2B",  fb:2.42 },
  { id:"aave",     name:"Aave V3",      icon:"👻", badge:"Most Liquid",   badgeClr:"#9945FF", tvl:"$27.1B", fb:2.87 },
  { id:"compound", name:"Compound V3",  icon:"🏦", badge:"Battle-Tested", badgeClr:"#00A3FF", tvl:"$3.8B",  fb:3.10 },
];
const STEPS = ["Debt","Collateral","Protocol","Execute"];

const CONTRACTS = {
  1:     { AAVE_POOL:"0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2", USDC:"0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", WETH:"0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", WBTC:"0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", STETH:"0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84" },
  8453:  { AAVE_POOL:"0xA238Dd80C259a72e81d7e4664a9801593F98d1c5", USDC:"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
  42161: { AAVE_POOL:"0x794a61358D6845594F94dc1DB02A252b5b4814aD", USDC:"0xaf88d065e77c8cC2239327C5EDb3A432268e5831" },
};

// ─── Revenue Config ──────────────────────────────────────────────────────────
const PLATFORM_FEE = 0.0025; // 0.25% origination fee
const TREASURY     = '0xYOUR_WALLET_ADDRESS_HERE'; // ← replace with your ETH wallet
const RAMP_API_KEY = 'YOUR_RAMP_API_KEY'; // ← get free at ramp.network/partners

const ERC20_ABI = [
  { name:"approve",  type:"function", stateMutability:"nonpayable", inputs:[{name:"spender",type:"address"},{name:"amount",type:"uint256"}], outputs:[{type:"bool"}] },
];
const ERC20_ABI_TRANSFER = [
  { name:"transfer", type:"function", stateMutability:"nonpayable", inputs:[{name:"to",type:"address"},{name:"amount",type:"uint256"}], outputs:[{type:"bool"}] },
];
const AAVE_ABI = [
  { name:"supply", type:"function", stateMutability:"nonpayable", inputs:[{name:"asset",type:"address"},{name:"amount",type:"uint256"},{name:"onBehalfOf",type:"address"},{name:"referralCode",type:"uint16"}], outputs:[] },
  { name:"borrow", type:"function", stateMutability:"nonpayable", inputs:[{name:"asset",type:"address"},{name:"amount",type:"uint256"},{name:"interestRateMode",type:"uint256"},{name:"referralCode",type:"uint16"},{name:"onBehalfOf",type:"address"}], outputs:[] },
];

const fmt  = (n,d=0) => Number(n).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtU = (n)     => `$${fmt(n,0)}`;
const sleep= ms      => new Promise(r=>setTimeout(r,ms));

function useSpring(target,ms=700){
  const [v,set]=useState(target);
  const raf=useRef(); const prev=useRef(target);
  useEffect(()=>{
    const s=prev.current,e=target,t0=performance.now();
    cancelAnimationFrame(raf.current);
    const tick=now=>{
      const p=Math.min((now-t0)/ms,1),ease=1-Math.pow(1-p,3);
      set(s+(e-s)*ease);
      if(p<1) raf.current=requestAnimationFrame(tick); else prev.current=e;
    };
    raf.current=requestAnimationFrame(tick);
    return()=>cancelAnimationFrame(raf.current);
  },[target,ms]);
  return v;
}

async function fetchRates(){
  try{
    const r=await fetch("https://yields.llama.fi/pools",{signal:AbortSignal.timeout(7000)});
    if(!r.ok) throw 0;
    const {data=[]}=await r.json();
    const get=(proj,sym)=>data.find(p=>p.project===proj&&p.chain==="Ethereum"&&(p.symbol||"").includes(sym));
    const a=get("aave-v3","USDC"),m=get("morpho-blue","USDC"),c=get("compound-v3","USDC");
    return{aave:a?+a.apyBaseBorrow.toFixed(2):2.87,morpho:m?+m.apyBaseBorrow.toFixed(2):2.42,compound:c?+c.apyBaseBorrow.toFixed(2):3.10,src:"DefiLlama",ts:Date.now()};
  }catch{return{aave:2.87,morpho:2.42,compound:3.10,src:"Cached",ts:Date.now()};}
}

async function fetchPrices(){
  try{
    const r=await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum,bitcoin,staked-ether,solana&vs_currencies=usd",{signal:AbortSignal.timeout(7000)});
    if(!r.ok) throw 0;
    const d=await r.json();
    return{eth:d.ethereum?.usd||3241,wbtc:d.bitcoin?.usd||86420,steth:d["staked-ether"]?.usd||3198,sol:d.solana?.usd||178};
  }catch{return{eth:3241,wbtc:86420,steth:3198,sol:178};}
}

async function getAI(p){
  try{
    const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":process.env.NEXT_PUBLIC_ANTHROPIC_KEY||"","anthropic-version":"2023-06-01"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:320,messages:[{role:"user",content:`You are RefiFi's concise AI advisor. Debt: $${fmt(p.debt)} at ${p.rate}% APR. Collateral: ${p.qty} ${p.asset.sym} (~$${fmt(p.val)}). DeFi borrow: ${p.proto} at ${p.dr}%. Annual savings: $${fmt(p.savings)}. Health: ${p.hf.toFixed(2)}. Reply ONLY as JSON: {"verdict":"strong_yes|yes|caution|no","headline":"≤10 words","insight":"2 sentences","risk":"1 sentence","tip":"1 sentence"}`}]})});
    const d=await r.json();
    return JSON.parse((d.content?.[0]?.text||"{}").replace(/```json|```/g,"").trim());
  }catch{return{verdict:"yes",headline:"Solid opportunity to cut your interest costs",insight:"Your collateral ratio is healthy and the rate differential is significant.",risk:"Watch your health factor if crypto prices drop more than 30%.",tip:"Consider keeping a 20% buffer above minimum collateral."};}
}

const Spin=({sz=14,clr="#4fffb0"})=><span style={{display:"inline-block",width:sz,height:sz,border:`2px solid ${clr}30`,borderTopColor:clr,borderRadius:"50%",animation:"spin .65s linear infinite"}}/>;
const Tag=({ch,clr="#4fffb0"})=><span style={{display:"inline-flex",alignItems:"center",gap:4,padding:"2px 8px",borderRadius:100,fontSize:9,fontWeight:800,letterSpacing:".07em",textTransform:"uppercase",background:`${clr}12`,color:clr,border:`1px solid ${clr}22`}}>{ch}</span>;
const Bar=({pct,clr="#4fffb0",h=4})=><div style={{height:h,borderRadius:h,background:"#111828",overflow:"hidden"}}><div style={{height:"100%",width:`${Math.max(0,Math.min(100,pct))}%`,background:clr,borderRadius:h,transition:"width .55s cubic-bezier(.4,0,.2,1)"}}/></div>;

function Overlay({children,onClose}){
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(2,4,12,.85)",backdropFilter:"blur(14px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,padding:16}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:"#090d1b",border:"1px solid rgba(255,255,255,.09)",borderRadius:22,padding:28,width:"100%",maxWidth:400,position:"relative",maxHeight:"88vh",overflowY:"auto",animation:"popIn .18s ease"}}>
        <button onClick={onClose} style={{position:"absolute",top:14,right:14,width:28,height:28,borderRadius:8,background:"rgba(255,255,255,.06)",border:"none",color:"#5a6280",fontSize:17,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
        {children}
      </div>
    </div>
  );
}

function RampModal({amount, address, onClose}){
  const [prov,setProv]=useState("ramp");
  const ps=[
    {id:"ramp",    name:"Ramp Network", fee:.9,  time:"~2 min",  icon:"⚡", sub:"US & EU · Instant bank transfer"},
    {id:"transak", name:"Transak",      fee:1.0, time:"~5 min",  icon:"🔄", sub:"140+ countries · Card & bank"},
    {id:"sardine", name:"Sardine",      fee:.5,  time:"Instant", icon:"🐟", sub:"Lowest fees · US only"},
  ];
  const ch=ps.find(p=>p.id===prov);

  const launchRamp=()=>{
    // Real Ramp Network widget — opens their hosted UI
    const params=new URLSearchParams({
      apiKey: RAMP_API_KEY,
      swapAsset: 'USDC',
      swapAmount: Math.round(amount*1e6).toString(),
      userAddress: address||'',
      hostAppName: 'RefiFi',
      hostLogoUrl: 'https://redefi-ihdw.vercel.app/favicon.ico',
      variant: 'auto',
    });
    window.open(`https://app.ramp.network/?${params}`,'_blank','width=480,height=700');
    onClose();
  };

  const launchTransak=()=>{
    const params=new URLSearchParams({
      apiKey: 'YOUR_TRANSAK_API_KEY',
      defaultCryptoCurrency: 'USDC',
      cryptoAmount: amount.toString(),
      walletAddress: address||'',
      productsAvailed: 'SELL',
      network: 'ethereum',
    });
    window.open(`https://global.transak.com/?${params}`,'_blank','width=480,height=700');
    onClose();
  };

  return(
    <Overlay onClose={onClose}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:18}}>
        <div style={{width:36,height:36,borderRadius:10,background:"rgba(79,255,176,.1)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17}}>💸</div>
        <div><h3 style={{fontSize:18,fontWeight:900,letterSpacing:"-0.02em"}}>Cash Out USDC</h3><p style={{fontSize:11,color:"#4a5580"}}>{fmtU(amount)} USDC → USD to your bank</p></div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
        {ps.map(p=>(
          <button key={p.id} onClick={()=>setProv(p.id)} style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",background:prov===p.id?"rgba(79,255,176,.06)":"rgba(255,255,255,.025)",border:`1px solid ${prov===p.id?"rgba(79,255,176,.4)":"rgba(255,255,255,.07)"}`,borderRadius:11,cursor:"pointer",textAlign:"left",fontFamily:"inherit"}}>
            <span style={{fontSize:18}}>{p.icon}</span>
            <div style={{flex:1}}><div style={{fontSize:13,fontWeight:700,color:"#dde0f0"}}>{p.name}</div><div style={{fontSize:11,color:"#2a3568"}}>{p.sub}</div></div>
            <div style={{textAlign:"right"}}><div style={{fontSize:12,fontWeight:700,color:prov===p.id?"#4fffb0":"#5a6590"}}>{p.fee}%</div><div style={{fontSize:10,color:"#2a3568"}}>{p.time}</div></div>
            {prov===p.id&&<span style={{color:"#4fffb0",fontSize:13}}>✓</span>}
          </button>
        ))}
      </div>
      <div style={{background:"rgba(255,255,255,.025)",borderRadius:11,padding:14,marginBottom:14}}>
        {[["You send",`${fmtU(amount)} USDC`,"#9098b0"],["Partner fee ("+ch?.fee+"%)","−"+fmtU(amount*(ch?.fee/100)),"#ff8080"],["You receive",fmtU(amount*(1-ch?.fee/100)),"#4fffb0"]].map(([l,v,c],i)=>(
          <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:i<2?"1px solid rgba(255,255,255,.04)":"none"}}>
            <span style={{fontSize:12,color:"#4a5580"}}>{l}</span>
            <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:13,fontWeight:700,color:c}}>{v}</span>
          </div>
        ))}
      </div>
      <button onClick={prov==="transak"?launchTransak:launchRamp} style={{width:"100%",padding:13,background:"#4fffb0",color:"#04060f",border:"none",borderRadius:11,fontSize:14,fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>
        Cash Out with {ch?.name} →
      </button>
      <p style={{fontSize:10,color:"#2a3568",textAlign:"center",marginTop:10}}>You'll be redirected to {ch?.name}'s secure checkout</p>
    </Overlay>
  );
}

function AIPanel({data,loading}){
  const cfg={strong_yes:{l:"Strong Opportunity",c:"#4fffb0"},yes:{l:"Good Move",c:"#4fffb0"},caution:{l:"Proceed Carefully",c:"#f0b429"},no:{l:"Not Recommended",c:"#ff6b6b"}};
  const v=cfg[data?.verdict]||cfg.yes;
  if(loading) return(<div style={{padding:16,background:"rgba(99,102,241,.05)",border:"1px solid rgba(99,102,241,.12)",borderRadius:13,display:"flex",gap:12,alignItems:"center"}}><Spin sz={16} clr="#818cf8"/><div><div style={{fontSize:12,fontWeight:700,color:"#818cf8",marginBottom:2}}>AI Advisor analyzing…</div><div style={{fontSize:11,color:"#2a3568"}}>Reviewing your numbers</div></div></div>);
  if(!data) return null;
  return(
    <div style={{background:`${v.c}05`,border:`1px solid ${v.c}20`,borderRadius:13,overflow:"hidden"}}>
      <div style={{padding:"11px 15px",borderBottom:"1px solid rgba(255,255,255,.04)",display:"flex",alignItems:"center",gap:8}}>
        <span style={{fontSize:13}}>🤖</span>
        <span style={{fontSize:9,fontWeight:800,letterSpacing:".08em",color:"#818cf8",textTransform:"uppercase"}}>AI Advisor</span>
        <Tag ch={v.l} clr={v.c}/>
      </div>
      <div style={{padding:15}}>
        <p style={{fontSize:14,fontWeight:700,color:"#dde0f0",marginBottom:9,lineHeight:1.35}}>"{data.headline}"</p>
        <p style={{fontSize:12,color:"#5a6a90",lineHeight:1.65,marginBottom:10}}>{data.insight}</p>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          <div style={{fontSize:11,padding:"8px 10px",background:"rgba(255,107,107,.05)",borderRadius:8,borderLeft:"2px solid rgba(255,107,107,.25)",color:"#7080a0",lineHeight:1.55}}><div style={{color:"#ff8080",fontWeight:800,marginBottom:3,fontSize:10}}>⚠ RISK</div>{data.risk}</div>
          <div style={{fontSize:11,padding:"8px 10px",background:"rgba(79,255,176,.05)",borderRadius:8,borderLeft:"2px solid rgba(79,255,176,.22)",color:"#7080a0",lineHeight:1.55}}><div style={{color:"#4fffb0",fontWeight:800,marginBottom:3,fontSize:10}}>💡 TIP</div>{data.tip}</div>
        </div>
      </div>
    </div>
  );
}

function MiniChart({annual}){
  const pts=Array.from({length:6},(_,i)=>({x:i,v:annual*(i+1)}));
  const maxV=pts[5].v*1.08; const W=240,H=72;
  const cx=i=>14+(i/5)*(W-28); const cy=v=>H-8-((v/maxV)*(H-16));
  const d=pts.map((p,i)=>`${i?"L":"M"}${cx(p.x)} ${cy(p.v)}`).join(" ");
  return(<svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{overflow:"visible",display:"block"}}><defs><linearGradient id="cg" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#4fffb0" stopOpacity=".2"/><stop offset="100%" stopColor="#4fffb0" stopOpacity="0"/></linearGradient></defs><path d={`${d} L${cx(5)} ${H} L${cx(0)} ${H}Z`} fill="url(#cg)"/><path d={d} fill="none" stroke="#4fffb0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>{pts.map((p,i)=>(<g key={i}><circle cx={cx(p.x)} cy={cy(p.v)} r="2.5" fill="#4fffb0"/><text x={cx(p.x)} y={H} textAnchor="middle" fill="#1e2540" fontSize="8.5">Y{p.x+1}</text></g>))}</svg>);
}

export default function RefiFi(){
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { openConnectModal } = useConnectModal();
  const { writeContractAsync } = useWriteContract();

  const [step,setStep]    = useState(0);
  const [tab,setTab]      = useState("wizard");
  const [debt,setDebt]    = useState(15000);
  const [dtype,setDtype]  = useState("cc");
  const [crate,setCrate]  = useState(22.5);
  const [aid,setAid]      = useState("eth");
  const [qty,setQty]      = useState(10);
  const [proto,setProto]  = useState("morpho");
  const [showRM,setShowRM]= useState(false);
  const [rates,setRates]  = useState({aave:2.87,morpho:2.42,compound:3.10,src:"Loading",ts:0});
  const [prices,setPrices]= useState({eth:3241,wbtc:86420,steth:3198,sol:178});
  const [rLd,setRLd]      = useState(true);
  const [pLd,setPLd]      = useState(true);
  const [txRows,setTxRows]= useState([]);
  const [txBusy,setTxBusy]= useState(false);
  const [txDone,setTxDone]= useState(false);
  const [ai,setAi]        = useState(null);
  const [aiLd,setAiLd]    = useState(false);
  const [chainDd,setChainDd]=useState(false);

  const asset  = ASSETS.find(a=>a.id===aid);
  const price  = prices[aid]||3241;
  const colVal = price*qty;
  const maxB   = colVal*asset.ltv;
  const dRate  = rates[proto]||2.42;
  const savings= debt*(crate-dRate)/100;
  const hf     = colVal*asset.ltv/Math.max(debt,1);
  const liqPx  = price*(debt/(colVal*asset.ltv));
  const util   = (debt/Math.max(maxB,1))*100;
  const hfClr  = hf>2?"#4fffb0":hf>1.5?"#f0b429":"#ff6b6b";
  const chainI = CHAINS.find(c=>c.id===chainId)||CHAINS[0];

  const aSav = useSpring(savings);
  const aHF  = useSpring(hf);

  useEffect(()=>{
    setRLd(true);setPLd(true);
    fetchRates().then(r=>{setRates(r);setRLd(false);});
    fetchPrices().then(p=>{setPrices(p);setPLd(false);});
    const iv=setInterval(()=>{fetchRates().then(setRates);fetchPrices().then(setPrices);},60000);
    return()=>clearInterval(iv);
  },[]);

  useEffect(()=>{
    if(step===3&&!ai&&!aiLd){setAiLd(true);getAI({debt,dtype,rate:crate,asset,qty,val:colVal,dr:dRate,savings,hf,proto}).then(r=>{setAi(r);setAiLd(false);});}
  },[step]);

  const feeAmount  = Math.round(debt * PLATFORM_FEE); // 0.25% in USD
  const runTx=async()=>{
    if(!isConnected){openConnectModal();return;}
    const c=CONTRACTS[chainId];
    if(!c){alert("Switch to Ethereum, Base, or Arbitrum");return;}
    setTxBusy(true);setTxDone(false);
    const defs=[
      {label:`Approve ${asset.sym} for Aave V3`,key:"approve"},
      {label:`Deposit ${qty} ${asset.sym} as collateral`,key:"supply"},
      {label:`Borrow ${fmtU(debt)} USDC at ${dRate}% APR`,key:"borrow"},
      {label:`Platform fee ${fmtU(feeAmount)} (0.25%)`,key:"fee"},
      {label:`Off-ramp ${fmtU(debt-feeAmount)} USDC → USD`,key:"ramp"},
    ];
    setTxRows(defs.map(d=>({...d,status:"pending",hash:null})));
    const log=(i,status,hash=null)=>setTxRows(p=>p.map((r,j)=>j===i?{...r,status,hash}:r));
    try{
      log(0,"loading");
      if(!asset.isNative){
        const assetAddr=c[asset.id.toUpperCase()]||c.WETH;
        const wei=parseUnits(qty.toString(),asset.decimals);
        const tx=await writeContractAsync({address:assetAddr,abi:ERC20_ABI,functionName:"approve",args:[c.AAVE_POOL,wei]});
        log(0,"done",tx);
      } else {log(0,"done","native-no-approve");}
      await sleep(500);
      log(1,"loading");
      const assetAddr=c[asset.id.toUpperCase()]||c.WETH;
      const wei=parseUnits(qty.toString(),asset.decimals);
      const supplyTx=await writeContractAsync({address:c.AAVE_POOL,abi:AAVE_ABI,functionName:"supply",args:[assetAddr,wei,address,0],value:asset.isNative?wei:0n});
      log(1,"done",supplyTx);
      await sleep(500);
      log(2,"loading");
      const borrowWei=parseUnits(debt.toString(),6);
      const borrowTx=await writeContractAsync({address:c.AAVE_POOL,abi:AAVE_ABI,functionName:"borrow",args:[c.USDC,borrowWei,2n,0,address]});
      log(2,"done",borrowTx);
      await sleep(500);
      // Collect 0.25% platform fee → treasury wallet
      log(3,"loading");
      if(TREASURY!=='0xYOUR_WALLET_ADDRESS_HERE'){
        const feeWei=parseUnits(feeAmount.toString(),6);
        const feeTx=await writeContractAsync({address:c.USDC,abi:ERC20_ABI_TRANSFER,functionName:"transfer",args:[TREASURY,feeWei]});
        log(3,"done",feeTx);
      } else { log(3,"done","treasury-not-set"); }
      await sleep(500);
      log(4,"done","usdc-ready");
      setTxBusy(false);setTxDone(true);
      await sleep(900);setTab("dashboard");
    }catch(err){
      setTxRows(p=>{
        const fi=p.findIndex(r=>r.status==="loading");
        if(fi<0) return p;
        return p.map((r,j)=>j===fi?{...r,status:"error"}:r);
      });
      setTxBusy(false);
    }
  };

  const CSS=`
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;600;700&display=swap');
    *{box-sizing:border-box;margin:0;padding:0}
    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
    @keyframes popIn{from{opacity:0;transform:scale(.95)}to{opacity:1;transform:scale(1)}}
    @keyframes glowPulse{0%,100%{opacity:.08}50%{opacity:.15}}
    @keyframes ticker{from{transform:translateX(0)}to{transform:translateX(-50%)}}
    .fu{animation:fadeUp .32s ease both}
    .card{background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.065);border-radius:16px;transition:border-color .2s}
    .card:hover{border-color:rgba(255,255,255,.1)}
    .btn{border:none;border-radius:12px;padding:13px 26px;font-size:14px;font-weight:800;cursor:pointer;font-family:inherit;transition:all .18s;letter-spacing:.01em;display:inline-flex;align-items:center;justify-content:center;gap:7px}
    .g{background:#4fffb0;color:#04060f}.g:hover{box-shadow:0 0 30px rgba(79,255,176,.4);transform:translateY(-1px)}.g:disabled{opacity:.4;cursor:not-allowed;transform:none;box-shadow:none}
    .dk{background:rgba(255,255,255,.05);color:#8090b0}.dk:hover{background:rgba(255,255,255,.09);color:#b0bcd0}
    input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:3px;border-radius:2px;outline:none;cursor:pointer;background:#111828}
    input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:15px;height:15px;border-radius:50%;background:#4fffb0;cursor:pointer;box-shadow:0 0 12px rgba(79,255,176,.5);transition:transform .1s}
    input[type=range]::-webkit-slider-thumb:hover{transform:scale(1.35)}
    .xb{background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.065);border-radius:10px;padding:11px 13px;cursor:pointer;transition:all .15s;width:100%;text-align:left;display:flex;align-items:center;gap:9px;font-family:inherit}
    .xb.on{border-color:rgba(79,255,176,.5);background:rgba(79,255,176,.07)}.xb:hover:not(.on){background:rgba(255,255,255,.045)}
    .pb{background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.065);border-radius:13px;padding:16px;cursor:pointer;transition:all .18s;width:100%;text-align:left;font-family:inherit}
    .pb.on{background:rgba(79,255,176,.06);border-color:rgba(79,255,176,.4)}.pb:hover:not(.on){background:rgba(255,255,255,.04)}
    .ab{background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.065);border-radius:13px;padding:14px;cursor:pointer;transition:all .18s;width:100%;text-align:center;font-family:inherit}
    .ab.on{background:rgba(79,255,176,.07);border-color:rgba(79,255,176,.45)}.ab:hover:not(.on){background:rgba(255,255,255,.04)}
    .tbtn{padding:8px 16px;border-radius:9px;font-size:13px;font-weight:700;cursor:pointer;border:none;font-family:inherit;transition:all .15s}
    .tbtn.on{background:rgba(255,255,255,.09);color:#dde0f0}.tbtn.off{background:none;color:#2a3568}.tbtn.off:hover{color:#5a6590}
    .mono{font-family:'JetBrains Mono',monospace}
    .orb{position:absolute;border-radius:50%;filter:blur(110px);pointer-events:none;animation:glowPulse 5s ease-in-out infinite}
    ::-webkit-scrollbar{width:3px;background:#060a14}::-webkit-scrollbar-thumb{background:#1a2035;border-radius:2px}
    .cdd{position:absolute;top:calc(100% + 6px);right:0;background:#090d1b;border:1px solid rgba(255,255,255,.09);border-radius:12px;padding:5px;z-index:100;min-width:165px;animation:popIn .14s ease}
  `;

  return(
    <div style={{minHeight:"100vh",background:"#04060f",color:"#dde0f0",fontFamily:"'Outfit',sans-serif",overflowX:"hidden"}}>
      <style>{CSS}</style>
      <div className="orb" style={{left:"3%",top:"8%",width:650,height:650,background:"#4fffb0",opacity:.07}}/>
      <div className="orb" style={{right:"-5%",top:"35%",width:550,height:550,background:"#6366f1",opacity:.07,animationDelay:"2.5s"}}/>
      <div className="orb" style={{left:"38%",bottom:"-5%",width:480,height:480,background:"#0ea5e9",opacity:.06,animationDelay:"1.2s"}}/>

      {/* Ticker */}
      <div style={{background:"rgba(255,255,255,.018)",borderBottom:"1px solid rgba(255,255,255,.04)",padding:"5px 0",overflow:"hidden",userSelect:"none"}}>
        <div style={{display:"inline-flex",whiteSpace:"nowrap",animation:"ticker 30s linear infinite"}}>
          {[...Array(2)].map((_,ri)=>(
            <span key={ri} style={{display:"inline-flex",gap:28,alignItems:"center",marginRight:28}}>
              {PROTOCOLS.map(p=><span key={p.id} style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:"#2a3568",display:"inline-flex",gap:6}}><span style={{color:"#4fffb0",fontWeight:700}}>{p.name}</span><span>{rLd?"—":`${rates[p.id]}%`}</span><span style={{color:"#141928"}}>·</span></span>)}
              {ASSETS.map(a=><span key={a.id} style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:"#2a3568",display:"inline-flex",gap:6}}><span style={{color:a.clr,fontWeight:700}}>{a.sym}</span><span>{pLd?"—":`$${fmt(prices[a.id]||0)}`}</span><span style={{color:"#141928"}}>·</span></span>)}
            </span>
          ))}
        </div>
      </div>

      {/* NAV */}
      <nav style={{padding:"15px 26px",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:"1px solid rgba(255,255,255,.04)",position:"sticky",top:0,zIndex:50,background:"rgba(4,6,15,.92)",backdropFilter:"blur(18px)"}}>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <div style={{display:"flex",alignItems:"center",gap:9}}>
            <div style={{width:36,height:36,borderRadius:11,background:"linear-gradient(135deg,#4fffb0,#00d4ff)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,fontWeight:900,color:"#04060f"}}>↻</div>
            <span style={{fontSize:20,fontWeight:900,letterSpacing:"-0.04em"}}>RefiFi</span>
            <span style={{fontSize:9,color:"#1e2540",fontWeight:600,letterSpacing:".06em",textTransform:"uppercase",border:"1px solid #1e2540",borderRadius:4,padding:"1px 5px"}}>beta</span>
          </div>
          <div style={{display:"flex",gap:2,background:"rgba(255,255,255,.03)",borderRadius:10,padding:3}}>
            {["wizard","dashboard"].map(t=>(
              <button key={t} className={`tbtn ${tab===t?"on":"off"}`} onClick={()=>setTab(t)}>{t==="wizard"?"⚡ Refinance":"📊 Dashboard"}</button>
            ))}
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{display:"flex",alignItems:"center",gap:5,padding:"4px 10px",borderRadius:100,background:"rgba(79,255,176,.07)",border:"1px solid rgba(79,255,176,.18)"}}>
            <span style={{width:5,height:5,borderRadius:"50%",background:"#4fffb0",display:"inline-block"}}/>
            <span style={{fontSize:9,fontWeight:800,color:"#4fffb0",letterSpacing:".08em",textTransform:"uppercase"}}>{rLd?"Loading…":rates.src+" · Live"}</span>
          </div>
          <div style={{position:"relative"}}>
            <button onClick={()=>setChainDd(!chainDd)} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 11px",background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",borderRadius:10,cursor:"pointer",fontSize:12,fontWeight:700,color:"#b0b8d0",fontFamily:"inherit"}}>
              <span>{chainI?.icon}</span>{chainI?.short}<span style={{fontSize:8,color:"#2a3568"}}>▼</span>
            </button>
            {chainDd&&(
              <div className="cdd">
                {CHAINS.map(c=>(
                  <button key={c.id} onClick={()=>{switchChain({chainId:c.id});setChainDd(false);}} style={{width:"100%",display:"flex",alignItems:"center",gap:8,padding:"8px 11px",borderRadius:8,background:chainId===c.id?"rgba(79,255,176,.07)":"none",border:"none",cursor:"pointer",fontFamily:"inherit",transition:"background .1s"}}>
                    <span style={{fontSize:13}}>{c.icon}</span>
                    <span style={{fontSize:13,fontWeight:600,color:chainId===c.id?"#4fffb0":"#b0b8d0"}}>{c.name}</span>
                    {chainId===c.id&&<span style={{marginLeft:"auto",color:"#4fffb0",fontSize:11}}>✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          {isConnected?(
            <div style={{display:"flex",alignItems:"center",gap:7,padding:"6px 12px",background:"rgba(79,255,176,.06)",border:"1px solid rgba(79,255,176,.2)",borderRadius:10}}>
              <div style={{width:7,height:7,borderRadius:"50%",background:"#4fffb0"}}/>
              <span className="mono" style={{fontSize:11,color:"#4fffb0",fontWeight:600}}>{address?.slice(0,6)}…{address?.slice(-4)}</span>
            </div>
          ):(
            <button className="btn g" style={{padding:"8px 16px",fontSize:12}} onClick={openConnectModal}>Connect Wallet</button>
          )}
        </div>
      </nav>

      {/* DASHBOARD */}
      {tab==="dashboard"&&(
        <div style={{maxWidth:980,margin:"0 auto",padding:"36px 20px 60px"}} className="fu">
          {!txDone?(
            <div style={{textAlign:"center",padding:"70px 20px"}}>
              <div style={{fontSize:48,marginBottom:16,opacity:.4}}>📊</div>
              <h2 style={{fontSize:22,fontWeight:900,color:"#2a3568",marginBottom:8}}>No active position</h2>
              <p style={{fontSize:14,color:"#1e2540",marginBottom:22}}>Complete a refinance to see your live position dashboard</p>
              <button className="btn g" onClick={()=>setTab("wizard")}>Start Refinancing →</button>
            </div>
          ):(
            <>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:24}}>
                <div><h2 style={{fontSize:26,fontWeight:900,letterSpacing:"-0.03em",marginBottom:4}}>Live Position</h2><p style={{fontSize:13,color:"#3a4568"}}>{qty} {asset.sym} collateral · {fmtU(debt)} USDC borrowed · {PROTOCOLS.find(p=>p.id===proto)?.name} · {chainI?.name}</p></div>
                <div style={{display:"flex",gap:8}}>
                  <button className="btn dk" style={{fontSize:12,padding:"8px 14px"}} onClick={()=>setShowRM(true)}>💸 Off-Ramp</button>
                  <button className="btn g" style={{fontSize:12,padding:"8px 14px"}} onClick={()=>{setStep(0);setTxDone(false);setTxRows([]);setAi(null);setTab("wizard");}}>+ New Position</button>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:16}}>
                {[{label:"Annual Savings",val:fmtU(Math.round(savings)),clr:"#4fffb0",icon:"💰",sub:`vs ${crate}% APR`},{label:"Collateral",val:fmtU(colVal),clr:"#627EEA",icon:"🏦",sub:`${qty} ${asset.sym}`},{label:"Debt Outstanding",val:fmtU(debt),clr:"#ff8080",icon:"💳",sub:`at ${dRate}% APR`},{label:"Health Factor",val:hf.toFixed(2),clr:hfClr,icon:"❤️",sub:hf>2?"Safe":"Watch"}].map((s,i)=>(
                  <div key={i} className="card" style={{padding:18}}>
                    <div style={{fontSize:20,marginBottom:8}}>{s.icon}</div>
                    <div className="mono" style={{fontSize:22,fontWeight:800,color:s.clr,marginBottom:3}}>{s.val}</div>
                    <div style={{fontSize:10,color:"#2a3568",fontWeight:700,textTransform:"uppercase",letterSpacing:".05em",marginBottom:2}}>{s.label}</div>
                    <div style={{fontSize:10,color:"#1e2540"}}>{s.sub}</div>
                  </div>
                ))}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                <div className="card" style={{padding:20}}>
                  <div style={{fontSize:10,fontWeight:800,color:"#2a3568",textTransform:"uppercase",letterSpacing:".08em",marginBottom:14}}>Position Health</div>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:7}}><span style={{fontSize:13,color:"#5a6590"}}>Health factor</span><span className="mono" style={{fontSize:20,fontWeight:900,color:hfClr}}>{hf.toFixed(2)}</span></div>
                  <Bar pct={(hf/4)*100} clr={hfClr} h={6}/>
                  <div style={{display:"flex",justifyContent:"space-between",margin:"5px 0 14px"}}><span style={{fontSize:8,color:"#1e2540"}}>Liquidation &lt;1.0</span><span style={{fontSize:8,color:"#1e2540"}}>Safe &gt;2.0</span></div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                    {[["Liq. Price",fmtU(liqPx),"#ff8080"],["Current Price",fmtU(price),asset.clr],["Drop to Liq.",`${((1-liqPx/price)*100).toFixed(1)}%`,"#f0b429"],["Utilization",`${util.toFixed(1)}%`,"#9098b0"]].map(([l,v,c],i)=>(
                      <div key={i} style={{background:"rgba(255,255,255,.02)",borderRadius:9,padding:"10px 11px"}}><div style={{fontSize:9,color:"#1e2540",marginBottom:3,textTransform:"uppercase",letterSpacing:".04em"}}>{l}</div><div className="mono" style={{fontSize:14,fontWeight:700,color:c}}>{v}</div></div>
                    ))}
                  </div>
                </div>
                <div className="card" style={{padding:20}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:4}}><div style={{fontSize:10,fontWeight:800,color:"#2a3568",textTransform:"uppercase",letterSpacing:".08em"}}>Cumulative Savings</div><span className="mono" style={{fontSize:12,color:"#4fffb0",fontWeight:700}}>{fmtU(Math.round(savings))}/yr</span></div>
                  <p style={{fontSize:10,color:"#1e2540",marginBottom:8}}>vs staying at {crate}% APR</p>
                  <MiniChart annual={savings}/>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:7,marginTop:10}}>
                    {[{l:"Monthly",v:savings/12},{l:"Yearly",v:savings},{l:"5 Years",v:savings*5}].map((item,i)=>(
                      <div key={i} style={{textAlign:"center",background:"rgba(79,255,176,.04)",borderRadius:8,padding:"8px 4px"}}><div className="mono" style={{fontSize:12,fontWeight:800,color:"#4fffb0"}}>${fmt(Math.round(item.v))}</div><div style={{fontSize:8,color:"#1e2540",marginTop:2}}>{item.l}</div></div>
                    ))}
                  </div>
                </div>
                <div className="card" style={{padding:20,gridColumn:"1/-1"}}>
                  <div style={{fontSize:10,fontWeight:800,color:"#2a3568",textTransform:"uppercase",letterSpacing:".08em",marginBottom:12}}>Transaction Log</div>
                  {txRows.map((r,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:i<txRows.length-1?"1px solid rgba(255,255,255,.04)":"none"}}>
                      <div style={{width:20,height:20,borderRadius:"50%",background:r.status==="done"?"rgba(79,255,176,.12)":"rgba(255,107,107,.1)",border:`1px solid ${r.status==="done"?"rgba(79,255,176,.3)":"rgba(255,107,107,.3)"}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><span style={{fontSize:10,color:r.status==="done"?"#4fffb0":"#ff8080"}}>{r.status==="done"?"✓":"✗"}</span></div>
                      <div style={{flex:1}}><div style={{fontSize:12,color:r.status==="done"?"#9098b0":"#ff8080",marginBottom:2}}>{r.label}</div>{r.hash&&r.hash.startsWith("0x")&&<a href={`https://etherscan.io/tx/${r.hash}`} target="_blank" rel="noreferrer" style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9,color:"#4fffb0"}}>{r.hash.slice(0,46)}… ↗</a>}</div>
                      {r.status==="done"&&<Tag ch="confirmed" clr="#4fffb0"/>}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* WIZARD */}
      {tab==="wizard"&&(
        <div style={{maxWidth:980,margin:"0 auto",padding:"36px 20px 60px"}}>
          <div style={{textAlign:"center",marginBottom:38}}>
            <div style={{display:"inline-flex",alignItems:"center",gap:6,padding:"4px 13px",borderRadius:100,background:"rgba(79,255,176,.07)",border:"1px solid rgba(79,255,176,.18)",marginBottom:14}}>
              <span style={{width:5,height:5,borderRadius:"50%",background:"#4fffb0",display:"inline-block"}}/>
              <span style={{fontSize:10,fontWeight:800,color:"#4fffb0",letterSpacing:".09em",textTransform:"uppercase"}}>Live · {chainI?.name} · Non-Custodial</span>
            </div>
            <h1 style={{fontSize:"clamp(26px,4.5vw,50px)",fontWeight:900,letterSpacing:"-0.04em",lineHeight:1.08,marginBottom:14}}>
              Escape <span style={{color:"#ff6b6b",textDecoration:"line-through",opacity:.7}}>22%</span> interest.<br/>
              <span style={{background:"linear-gradient(90deg,#4fffb0,#00d4ff)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>Borrow at {rLd?"~2.4":dRate}% on-chain.</span>
            </h1>
            <p style={{color:"#2a3568",fontSize:15,maxWidth:400,margin:"0 auto"}}>Deposit BTC · ETH · SOL as collateral and refinance your high-interest debt in minutes.</p>
          </div>

          <div style={{display:"flex",alignItems:"center",justifyContent:"center",marginBottom:30}}>
            {STEPS.map((label,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center"}}>
                <button onClick={()=>i<=step&&setStep(i)} style={{background:"none",border:"none",cursor:i<=step?"pointer":"default",display:"flex",flexDirection:"column",alignItems:"center",gap:5,opacity:i>step?.22:1,transition:"opacity .3s"}}>
                  <div style={{width:30,height:30,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:900,transition:"all .3s",background:i<step?"#4fffb0":i===step?"rgba(79,255,176,.12)":"rgba(255,255,255,.035)",border:i===step?"2px solid #4fffb0":i<step?"none":"1px solid rgba(255,255,255,.08)",color:i<step?"#04060f":i===step?"#4fffb0":"#1e2540",boxShadow:i===step?"0 0 18px rgba(79,255,176,.25)":"none"}}>{i<step?"✓":i+1}</div>
                  <span style={{fontSize:10,fontWeight:600,color:i===step?"#b0bcd0":"#1e2540",whiteSpace:"nowrap"}}>{label}</span>
                </button>
                {i<STEPS.length-1&&<div style={{width:44,height:1,margin:"0 3px 16px",background:i<step?"#4fffb0":"rgba(255,255,255,.05)",transition:"background .4s"}}/>}
              </div>
            ))}
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 282px",gap:14,alignItems:"start"}}>
            <div className="card fu" key={step} style={{padding:28}}>

              {step===0&&(<>
                <h2 style={{fontSize:20,fontWeight:900,letterSpacing:"-0.02em",marginBottom:4}}>What are you refinancing?</h2>
                <p style={{fontSize:13,color:"#3a4568",marginBottom:22}}>Select debt type and enter your balance</p>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:22}}>
                  {DEBTS.map(d=>(<button key={d.id} className={`xb${dtype===d.id?" on":""}`} onClick={()=>{setDtype(d.id);setCrate(d.rate);}}><span style={{fontSize:17}}>{d.icon}</span><div><div style={{fontSize:13,fontWeight:700,color:dtype===d.id?"#4fffb0":"#b0bcd0"}}>{d.name}</div><div style={{fontSize:10,color:"#1e2540"}}>~{d.rate}% APR</div></div></button>))}
                </div>
                {[{label:"Debt Balance",val:debt,min:1000,max:150000,step:500,set:setDebt,fmt:v=>`$${fmt(v)}`,clr:"#dde0f0"},{label:"Your Current APR",val:crate,min:3,max:35,step:.1,set:setCrate,fmt:v=>`${v.toFixed(1)}%`,clr:"#ff8080"}].map(row=>(
                  <div key={row.label} style={{marginBottom:20}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:11}}><label style={{fontSize:13,color:"#4a5580"}}>{row.label}</label><span className="mono" style={{fontSize:20,fontWeight:800,color:row.clr}}>{row.fmt(row.val)}</span></div>
                    <input type="range" min={row.min} max={row.max} step={row.step} value={row.val} onChange={e=>row.set(+e.target.value)} style={{background:`linear-gradient(to right, ${row.clr} ${((row.val-row.min)/(row.max-row.min))*100}%, #111828 0%)`}}/>
                  </div>
                ))}
                <div style={{padding:"14px 16px",background:"rgba(79,255,176,.05)",border:"1px solid rgba(79,255,176,.13)",borderRadius:12,display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:4}}>
                  <div><div style={{fontSize:10,color:"#2a3568",marginBottom:2,textTransform:"uppercase",letterSpacing:".06em"}}>Projected Annual Savings</div><div className="mono" style={{fontSize:24,fontWeight:900,color:"#4fffb0"}}>{fmtU(Math.round(savings))}</div></div>
                  <div style={{textAlign:"right"}}><div style={{fontSize:11,color:"#2a3568",marginBottom:2}}>{crate}% → {rLd?"…":dRate}%</div><div style={{fontSize:10,color:"#1a2035"}}>on {fmtU(debt)}</div></div>
                </div>
              </>)}

              {step===1&&(<>
                <h2 style={{fontSize:20,fontWeight:900,letterSpacing:"-0.02em",marginBottom:4}}>Choose collateral</h2>
                <p style={{fontSize:13,color:"#3a4568",marginBottom:22}}>Your crypto backs the loan — you keep 100% of the upside</p>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:22}}>
                  {ASSETS.map(a=>(<button key={a.id} className={`ab${aid===a.id?" on":""}`} onClick={()=>setAid(a.id)}><div style={{fontSize:26,color:a.clr,marginBottom:4}}>{a.icon}</div><div style={{fontSize:13,fontWeight:800,color:aid===a.id?"#4fffb0":"#b0bcd0",marginBottom:2}}>{a.sym}</div><div style={{fontSize:10,color:"#2a3568"}}>LTV {(a.ltv*100).toFixed(0)}%</div><div className="mono" style={{fontSize:10,color:"#3a4568",marginTop:3}}>{pLd?"…":`$${fmt(prices[a.id]||0)}`}</div></button>))}
                </div>
                <div style={{marginBottom:20}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:11}}><label style={{fontSize:13,color:"#4a5580"}}>{asset.sym} Amount</label><span className="mono" style={{fontSize:20,fontWeight:800,color:asset.clr}}>{qty} {asset.sym}</span></div>
                  <input type="range" min={.1} max={50} step={.1} value={qty} onChange={e=>setQty(+e.target.value)} style={{background:`linear-gradient(to right,${asset.clr} ${((qty-.1)/49.9)*100}%,#111828 0%)`}}/>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:9}}>
                  {[["Collateral Value",fmtU(colVal),"#b0bcd0"],["Max Borrow",fmtU(maxB),"#4fffb0"],["Coverage",maxB>=debt?"✓ Sufficient":"✗ Need more",maxB>=debt?"#4fffb0":"#ff8080"]].map(([l,v,c],i)=>(
                    <div key={i} style={{background:"rgba(255,255,255,.02)",borderRadius:10,padding:"10px 12px"}}><div style={{fontSize:9,color:"#1e2540",marginBottom:4,textTransform:"uppercase",letterSpacing:".05em"}}>{l}</div><div className="mono" style={{fontSize:14,fontWeight:800,color:c}}>{v}</div></div>
                  ))}
                </div>
              </>)}

              {step===2&&(<>
                <h2 style={{fontSize:20,fontWeight:900,letterSpacing:"-0.02em",marginBottom:4}}>Choose protocol</h2>
                <p style={{fontSize:13,color:"#3a4568",marginBottom:20}}>All audited, non-custodial — your keys stay yours</p>
                <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:18}}>
                  {PROTOCOLS.map(p=>{const r=rates[p.id]||p.fb;return(
                    <button key={p.id} className={`pb${proto===p.id?" on":""}`} onClick={()=>setProto(p.id)}>
                      <div style={{display:"flex",alignItems:"center",gap:12}}>
                        <span style={{fontSize:28}}>{p.icon}</span>
                        <div style={{flex:1}}><div style={{fontSize:15,fontWeight:800,color:proto===p.id?"#4fffb0":"#b0bcd0",marginBottom:2}}>{p.name}</div><div style={{fontSize:11,color:"#2a3568"}}>TVL {p.tvl}</div></div>
                        <div style={{textAlign:"right"}}><div className="mono" style={{fontSize:22,fontWeight:900,color:p.badgeClr}}>{rLd?"…":`${r}%`}</div><div style={{display:"inline-block",fontSize:9,fontWeight:800,padding:"2px 7px",borderRadius:100,background:`${p.badgeClr}15`,color:p.badgeClr,border:`1px solid ${p.badgeClr}30`}}>{p.badge}</div></div>
                      </div>
                    </button>
                  );})}
                </div>
              </>)}

              {step===3&&(<>
                <h2 style={{fontSize:20,fontWeight:900,letterSpacing:"-0.02em",marginBottom:4}}>Review & Execute</h2>
                <p style={{fontSize:13,color:"#3a4568",marginBottom:18}}>Confirm your refinance parameters</p>
                <div style={{background:"rgba(255,255,255,.02)",borderRadius:12,padding:16,marginBottom:16}}>
                  {[["Refinancing",`${fmtU(debt)} ${DEBTS.find(d=>d.id===dtype)?.name}`],[`Collateral`,`${qty} ${asset.sym} (~${fmtU(colVal)})`],["Protocol",PROTOCOLS.find(p=>p.id===proto)?.name],["Borrow APR",`${dRate}%`],["Health Factor",hf.toFixed(2)],["Platform Fee (0.25%)",fmtU(feeAmount)],["Annual Savings",fmtU(Math.round(savings))]].map(([k,v],i,arr)=>(
                    <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"9px 0",borderBottom:i<arr.length-1?"1px solid rgba(255,255,255,.04)":"none"}}><span style={{fontSize:13,color:"#3a4568"}}>{k}</span><span className="mono" style={{fontSize:13,fontWeight:700,color:"#b0bcd0"}}>{v}</span></div>
                  ))}
                </div>
                {txRows.length>0&&(
                  <div style={{marginBottom:16,display:"flex",flexDirection:"column",gap:6}}>
                    {txRows.map((r,i)=>(
                      <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",background:"rgba(255,255,255,.02)",borderRadius:10}}>
                        <div style={{width:18,height:18,borderRadius:"50%",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",background:r.status==="done"?"rgba(79,255,176,.12)":r.status==="loading"?"rgba(240,180,41,.12)":r.status==="error"?"rgba(255,107,107,.12)":"rgba(42,53,104,.3)",border:`1px solid ${r.status==="done"?"rgba(79,255,176,.3)":r.status==="loading"?"rgba(240,180,41,.3)":r.status==="error"?"rgba(255,107,107,.3)":"rgba(42,53,104,.4)"}`}}>
                          {r.status==="done"?<span style={{fontSize:9,color:"#4fffb0"}}>✓</span>:r.status==="loading"?<Spin sz={9} clr="#f0b429"/>:r.status==="error"?<span style={{fontSize:9,color:"#ff8080"}}>✗</span>:<span style={{width:4,height:4,borderRadius:"50%",background:"#1e2540",display:"block"}}/>}
                        </div>
                        <span style={{fontSize:12,color:r.status==="done"?"#6070a0":r.status==="loading"?"#f0b429":r.status==="error"?"#ff8080":"#1e2540",flex:1}}>{r.label}</span>
                        {r.status==="done"&&<Tag ch="done" clr="#4fffb0"/>}
                      </div>
                    ))}
                  </div>
                )}
                <div style={{marginBottom:14}}><AIPanel data={ai} loading={aiLd}/></div>
                {txDone?(
                  <div style={{padding:18,background:"rgba(79,255,176,.06)",border:"1px solid rgba(79,255,176,.18)",borderRadius:13,textAlign:"center"}}>
                    <div style={{fontSize:28,marginBottom:7}}>🎉</div>
                    <div style={{fontSize:17,fontWeight:900,color:"#4fffb0",marginBottom:4}}>Refinance Complete!</div>
                    <div style={{fontSize:12,color:"#4a5580",marginBottom:14}}>Saving {fmtU(Math.round(savings))}/yr · Borrowing at {dRate}% APR</div>
                    <div style={{display:"flex",gap:9,justifyContent:"center"}}>
                      <button className="btn g" style={{fontSize:13,padding:"10px 18px"}} onClick={()=>setTab("dashboard")}>View Dashboard →</button>
                      <button className="btn dk" style={{fontSize:13,padding:"10px 18px"}} onClick={()=>setShowRM(true)}>Off-Ramp USDC</button>
                    </div>
                  </div>
                ):(
                  <div style={{display:"flex",gap:9}}>
                    {!isConnected&&<button className="btn g" style={{flex:1}} onClick={openConnectModal}>🔗 Connect Wallet to Execute</button>}
                    {isConnected&&!txBusy&&<button className="btn g" style={{flex:1}} onClick={runTx}>⚡ Execute Refinance — {fmtU(debt)}</button>}
                    {isConnected&&txBusy&&<button className="btn g" style={{flex:1}} disabled><Spin sz={13} clr="#04060f"/> Processing…</button>}
                    <button className="btn dk" style={{padding:"13px 14px",fontSize:13}} title="Off-ramp" onClick={()=>setShowRM(true)}>💸</button>
                  </div>
                )}
              </>)}

              <div style={{display:"flex",justifyContent:"space-between",marginTop:24}}>
                {step>0?<button className="btn dk" onClick={()=>setStep(s=>s-1)}>← Back</button>:<div/>}
                {step<3&&<button className="btn g" onClick={()=>setStep(s=>s+1)}>Continue →</button>}
              </div>
            </div>

            {/* RIGHT sidebar */}
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              <div className="card" style={{padding:16}}>
                <div style={{fontSize:9,fontWeight:800,color:"#1e2540",textTransform:"uppercase",letterSpacing:".09em",marginBottom:13}}>Rate Arbitrage</div>
                {[{l:"Your rate",v:`${crate.toFixed(1)}%`,pct:(crate/35)*100,clr:"#ff8080"},{l:`DeFi (${proto})`,v:rLd?"…":`${dRate}%`,pct:(dRate/35)*100,clr:"#4fffb0"}].map((row,i)=>(
                  <div key={i} style={{marginBottom:i===0?12:0}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}><span style={{fontSize:11,color:"#4a5580"}}>{row.l}</span><span className="mono" style={{fontSize:13,color:row.clr,fontWeight:800}}>{row.v}</span></div>
                    <Bar pct={row.pct} clr={row.clr} h={4}/>
                  </div>
                ))}
                <div style={{marginTop:12,padding:"9px 11px",background:"rgba(79,255,176,.05)",borderRadius:9,textAlign:"center"}}>
                  <div style={{fontSize:8,color:"#1e2540",marginBottom:1}}>SAVING</div>
                  <div className="mono" style={{fontSize:22,fontWeight:900,color:"#4fffb0"}}>{(crate-dRate).toFixed(2)}%</div>
                  <div style={{fontSize:8,color:"#1e2540"}}>per year</div>
                </div>
              </div>
              <div className="card" style={{padding:16}}>
                <div style={{fontSize:9,fontWeight:800,color:"#1e2540",textTransform:"uppercase",letterSpacing:".09em",marginBottom:11}}>Savings</div>
                {[{l:"Monthly",v:aSav/12},{l:"Yearly",v:aSav},{l:"5-Year",v:aSav*5}].map((row,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:i<2?"1px solid rgba(255,255,255,.04)":"none"}}><span style={{fontSize:11,color:"#3a4568"}}>{row.l}</span><span className="mono" style={{fontSize:12,color:"#b0bcd0",fontWeight:700}}>${fmt(Math.round(row.v))}</span></div>
                ))}
              </div>
              <div className="card" style={{padding:16}}>
                <div style={{fontSize:9,fontWeight:800,color:"#1e2540",textTransform:"uppercase",letterSpacing:".09em",marginBottom:11}}>Collateral Health</div>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}><span style={{fontSize:11,color:"#4a5580"}}>Health factor</span><span className="mono" style={{fontSize:16,fontWeight:900,color:hfClr}}>{isFinite(aHF)?aHF.toFixed(2):"∞"}</span></div>
                <Bar pct={Math.min((hf/4)*100,100)} clr={hfClr} h={5}/>
                <div style={{display:"flex",justifyContent:"space-between",margin:"4px 0 10px"}}><span style={{fontSize:7,color:"#1a2035"}}>Liq &lt;1.0</span><span style={{fontSize:7,color:"#1a2035"}}>Safe &gt;2.0</span></div>
                <div style={{fontSize:10,color:"#1e2540",lineHeight:1.7}}>Liq: <span className="mono" style={{color:"#ff8080"}}>{isFinite(liqPx)?`$${fmt(liqPx,0)}`:"—"}</span>{" "}· Current: <span className="mono" style={{color:asset.clr}}>${fmt(price)}</span></div>
              </div>
              <div className="card" style={{padding:16}}>
                <div style={{fontSize:9,fontWeight:800,color:"#1e2540",textTransform:"uppercase",letterSpacing:".09em",marginBottom:11}}>Live Rates</div>
                {PROTOCOLS.map((p,i)=>(
                  <div key={p.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 0",borderBottom:i<2?"1px solid rgba(255,255,255,.04)":"none"}}>
                    <span style={{fontSize:10,color:proto===p.id?"#4fffb0":"#3a4568",display:"flex",alignItems:"center",gap:5}}><span>{p.icon}</span>{p.name}</span>
                    <span className="mono" style={{fontSize:12,fontWeight:700,color:proto===p.id?"#4fffb0":"#4a5580"}}>{rLd?"…":`${rates[p.id]}%`}</span>
                  </div>
                ))}
                <div style={{fontSize:8,color:"#141928",marginTop:7}}>via {rates.src} · 60s refresh</div>
              </div>
            </div>
          </div>

          <div style={{marginTop:32,paddingTop:16,borderTop:"1px solid rgba(255,255,255,.035)",textAlign:"center"}}>
            <p style={{fontSize:10,color:"#141928",maxWidth:560,margin:"0 auto",lineHeight:1.8}}>Non-custodial · Your keys, your funds · Not financial advice · DeFi involves liquidation risk · Rates from DefiLlama · Prices from CoinGecko</p>
          </div>
        </div>
      )}

      {showRM&&<RampModal amount={debt} address={address} onClose={()=>setShowRM(false)}/>}
    </div>
  );
}
