const TOKEN = Deno.env.get("BOT_TOKEN")!;
const GROUP = Deno.env.get("GROUP_CHAT_ID")!;

const sessions = new Map<number, any>();

function getSession(id:number){
  if(!sessions.has(id)){
    sessions.set(id,{step:1,data:{name:"",truck:"",issue:"",drop:"",media:[]}});
  }
  return sessions.get(id);
}

async function send(chat:string,text:string,k?:any){
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({chat_id:chat,text,reply_markup:k})
  });
}

async function sendMedia(items:any[]){
  if(!items.length)return;
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMediaGroup`,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      chat_id:GROUP,
      media:items.map((m:any,i:number)=>({
        type:m.type,
        media:m.file_id,
        caption:i===0?"Repair media":undefined
      }))
    })
  });
}

function card(s:any){
  return `🚛 NEW REPORT

Name - ${s.data.name||"—"}
Truck - ${s.data.truck||"—"}
Issue - ${s.data.issue||"—"}

Files - ${s.data.media.length}

Drop-off date - ${s.data.drop||"—"}`;
}

Deno.serve(async(req)=>{
  const u=await req.json();
  const msg=u.message;
  const cb=u.callback_query;

  if(cb){
    const s=getSession(cb.from.id);

    if(cb.data==="confirm"){
      await send(GROUP,card(s));
      await sendMedia(s.data.media);

      await send(cb.message.chat.id,"Report sent successfully",{
        inline_keyboard:[[ {text:"Create new report",callback_data:"new"} ]]
      });

      s.step=1;
      s.data={name:"",truck:"",issue:"",drop:"",media:[]};
      return new Response("ok");
    }

    if(cb.data==="new"){
      const s2=getSession(cb.from.id);
      s2.step=1;
      s2.data={name:"",truck:"",issue:"",drop:"",media:[]};
      await send(cb.message.chat.id,"Enter full name");
      return new Response("ok");
    }
  }

  if(!msg) return new Response("ok");
  if(msg.chat.type!=="private") return new Response("ok");

  const s=getSession(msg.from.id);
  const text=msg.text?.trim()||"";

  if(text==="/start"){
    s.step=1;
    await send(msg.chat.id,"Enter full name");
    return new Response("ok");
  }

  if(s.step===1){
    s.data.name=text; s.step=2;
    await send(msg.chat.id,"Enter truck number");
    return new Response("ok");
  }

  if(s.step===2){
    s.data.truck=text; s.step=3;
    await send(msg.chat.id,"Describe the issue");
    return new Response("ok");
  }

  if(s.step===3){
    s.data.issue=text; s.step=4;
    await send(msg.chat.id,"Drop-off date");
    return new Response("ok");
  }

  if(s.step===4){
    s.data.drop=text; s.step=5;
    await send(msg.chat.id,"Send photos or videos");
    return new Response("ok");
  }

  if(s.step===5){
    if(!msg.photo && !msg.video) return new Response("ok");

    const item=msg.photo
      ?{type:"photo",file_id:msg.photo.at(-1).file_id}
      :{type:"video",file_id:msg.video.file_id};

    s.data.media.push(item);

    if(s.data.media.length===1){
      await send(msg.chat.id,card(s),{
        inline_keyboard:[[ {text:"Confirm",callback_data:"confirm"} ]]
      });
    }

    return new Response("ok");
  }

  return new Response("ok");
});
