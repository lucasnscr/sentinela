import { getSnapshot } from '@/lib/db';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request){
  const encoder=new TextEncoder();let stopped=false;let busy=false;let timer:ReturnType<typeof setInterval>;
  const stream=new ReadableStream({
    start(controller){
      const stop=()=>{if(stopped)return;stopped=true;clearInterval(timer);try{controller.close();}catch{}};
      request.signal.addEventListener('abort',stop,{once:true});
      const send=async()=>{
        if(stopped||busy)return;busy=true;
        try{const snapshot=await getSnapshot();if(!stopped)controller.enqueue(encoder.encode('event: snapshot\ndata: '+JSON.stringify(snapshot)+'\n\n'));}
        catch{if(!stopped)controller.enqueue(encoder.encode('event: unavailable\ndata: {"error":"Banco temporariamente indisponível"}\n\n'));}
        finally{busy=false;}
      };
      timer=setInterval(()=>void send(),2500);void send();
    },
    cancel(){stopped=true;clearInterval(timer);}
  });
  return new Response(stream,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform',Connection:'keep-alive','X-Accel-Buffering':'no'}});
}
