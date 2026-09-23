export function normalizeEmail(value:string):string{
  return value.trim().toLowerCase();
}

export function validateEmail(value:string):string|null{
  const email=normalizeEmail(value);
  if(email.length<5||email.length>254||!email.includes('@'))return 'Enter a valid email address.';
  const [local,domain]=email.split('@');
  if(!local||!domain||!domain.includes('.')||domain.startsWith('.')||domain.endsWith('.'))return 'Enter a valid email address.';
  return null;
}

export function validatePassword(value:string):string|null{
  return value.length>=10?null:'Use a password with at least 10 characters.';
}

export function isUuid(value:string):boolean{
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function normalizeCountryCode(value?:string):string|undefined{
  const code=value?.trim().toUpperCase();
  if(!code)return undefined;
  if(!/^[A-Z]{2}$/.test(code))throw new Error('Country code must use two letters.');
  return code;
}

export function assertDateRange(startsAt?:string,endsAt?:string):void{
  if(!startsAt||!endsAt)return;
  const start=new Date(startsAt).getTime();
  const end=new Date(endsAt).getTime();
  if(!Number.isFinite(start)||!Number.isFinite(end))throw new Error('Enter valid dates.');
  if(end<start)throw new Error('End date cannot be before start date.');
}

export function normalizeOptionalUrl(value?:string):string|undefined{
  const clean=value?.trim();
  if(!clean)return undefined;
  const parsed=new URL(clean);
  if(!['https:','http:'].includes(parsed.protocol))throw new Error('Website must use HTTP or HTTPS.');
  return parsed.toString();
}

export function assertSafeMerge(sourceId:string,targetId:string,reason:string):void{
  if(!isUuid(sourceId)||!isUuid(targetId))throw new Error('Merge source and target must be valid UUIDs.');
  if(sourceId===targetId)throw new Error('Merge source and target must differ.');
  if(reason.trim().length<3)throw new Error('A merge reason is required.');
}
