import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const allowedOrigins=(Deno.env.get('BUHURTOS_ALLOWED_ORIGINS')??'')
  .split(',')
  .map(value=>value.trim())
  .filter(Boolean);

function cors(origin:string|null){
  const allowed=origin&&allowedOrigins.includes(origin)?origin:allowedOrigins[0]??'';
  return {
    'Access-Control-Allow-Origin':allowed,
    'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods':'POST, OPTIONS',
    'Vary':'Origin'
  };
}

function response(origin:string|null,status:number,body:Record<string,unknown>){
  return new Response(JSON.stringify(body),{
    status,
    headers:{...cors(origin),'Content-Type':'application/json'}
  });
}

Deno.serve(async request=>{
  const origin=request.headers.get('origin');
  if(origin&&allowedOrigins.length>0&&!allowedOrigins.includes(origin)){
    return response(origin,403,{error:'Origin not allowed'});
  }
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors(origin)});
  if(request.method!=='POST')return response(origin,405,{error:'Method not allowed'});

  const supabaseUrl=Deno.env.get('SUPABASE_URL');
  const anonKey=Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const siteUrl=Deno.env.get('BUHURTOS_SITE_URL');
  const authorization=request.headers.get('Authorization');

  if(!supabaseUrl||!anonKey||!serviceRoleKey||!siteUrl){
    return response(origin,500,{error:'BuhurtOS invitation service is not configured'});
  }
  if(!authorization)return response(origin,401,{error:'Authentication required'});

  let body:{eventId?:string;email?:string;displayName?:string;role?:string;teamId?:string};
  try{body=await request.json();}catch{return response(origin,400,{error:'Invalid JSON body'});}

  if(!body.eventId||!body.email||!body.role){
    return response(origin,400,{error:'eventId, email and role are required'});
  }

  const caller=createClient(supabaseUrl,anonKey,{
    global:{headers:{Authorization:authorization}},
    auth:{persistSession:false,autoRefreshToken:false}
  });

  const {data:assignment,error:assignmentError}=await caller.rpc('invite_or_assign_event_member',{
    p_event_id:body.eventId,
    p_email:body.email,
    p_role_key:body.role,
    p_team_id:body.teamId??null
  });

  if(assignmentError)return response(origin,403,{error:assignmentError.message});

  const result=assignment as {invited?:boolean;assigned?:boolean;invitationId?:string}|null;
  if(result?.assigned){
    return response(origin,200,{invited:false,assigned:true,invitationId:result.invitationId});
  }

  const admin=createClient(supabaseUrl,serviceRoleKey,{
    auth:{persistSession:false,autoRefreshToken:false}
  });
  const redirectTo=siteUrl.replace(/\/$/,'')+'/#/ops/account-setup';
  const {error:inviteError}=await admin.auth.admin.inviteUserByEmail(body.email.trim().toLowerCase(),{
    redirectTo,
    data:body.displayName?.trim()?{display_name:body.displayName.trim()}:undefined
  });

  if(inviteError){
    return response(origin,502,{
      error:'Access was recorded, but the invitation email could not be sent: '+inviteError.message,
      invitationId:result?.invitationId
    });
  }

  return response(origin,200,{invited:true,assigned:false,invitationId:result?.invitationId});
});
