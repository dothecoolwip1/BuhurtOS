export interface NamedEntity { id:string; name:string; secondary?:string }

export interface DuplicateCandidate {
  leftId:string;
  rightId:string;
  score:number;
  reasons:string[];
}

export function normalizeEntityName(value:string):string{
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}

function levenshtein(a:string,b:string):number{
  const row=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
    let previous=row[0];row[0]=i;
    for(let j=1;j<=b.length;j++){
      const temp=row[j];
      row[j]=Math.min(row[j]+1,row[j-1]+1,previous+(a[i-1]===b[j-1]?0:1));
      previous=temp;
    }
  }
  return row[b.length];
}

export function nameSimilarity(a:string,b:string):number{
  const left=normalizeEntityName(a),right=normalizeEntityName(b);
  if(!left&&!right)return 1;
  if(!left||!right)return 0;
  if(left===right)return 1;
  const distance=levenshtein(left,right);
  return Math.max(0,1-distance/Math.max(left.length,right.length));
}

export function findDuplicateCandidates(entities:NamedEntity[],threshold=0.78):DuplicateCandidate[]{
  const out:DuplicateCandidate[]=[];
  for(let i=0;i<entities.length;i++)for(let j=i+1;j<entities.length;j++){
    const left=entities[i],right=entities[j];
    let score=nameSimilarity(left.name,right.name);
    const reasons:string[]=[];
    if(score>=threshold)reasons.push('similar name');
    if(left.secondary&&right.secondary&&normalizeEntityName(left.secondary)===normalizeEntityName(right.secondary)){
      score=Math.min(1,score+0.12);reasons.push('matching secondary identity');
    }
    if(score>=threshold)out.push({leftId:left.id,rightId:right.id,score,reasons});
  }
  return out.sort((a,b)=>b.score-a.score||a.leftId.localeCompare(b.leftId));
}
