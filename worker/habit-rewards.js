/** Rewards are derived from diary entries. Reloads, edits, duplicate syncs and
 * repeated taps cannot mint points; archive keeps earned experience. */
export const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100, 365];
export const COMPLETION_MILESTONES = [1, 10, 25, 50, 100, 250, 500];

function rewardDay(day, offset) {
  const date = new Date(day + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
function rewardDates(dates, startedOn, today) {
  return [...new Set(dates)].filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    day >= startedOn && day <= today && Number.isFinite(Date.parse(day + 'T12:00:00Z')) &&
    new Date(day+'T12:00:00Z').toISOString().slice(0,10)===day).sort();
}

export function habitRewards(habit, dates, today) {
  const days = rewardDates(dates, habit.startedOn, today);
  const done = new Set(days);
  let current = 0, longest = 0, run = 0, previous = '';
  for (const day of days) {
    run = previous && rewardDay(previous, 1) === day ? run + 1 : 1;
    longest = Math.max(longest, run); previous = day;
  }
  let cursor = done.has(today) ? today : rewardDay(today, -1);
  while (done.has(cursor)) {current++; cursor = rewardDay(cursor, -1);}
  const next = STREAK_MILESTONES.find(mark => mark > current) || (Math.floor(current / 100) + 1) * 100;
  const badges = [
    ...STREAK_MILESTONES.map(mark => ({id:'streak-'+mark, title:mark===7?'Super streak':mark===30?'Legendary streak':mark+' day streak',
      detail:mark+' consecutive days', icon:'🔥', earned:longest>=mark})),
    ...COMPLETION_MILESTONES.map(mark => ({id:'days-'+mark, title:mark===1?'First step':mark+' days done',
      detail:mark+' completed habit '+(mark===1?'day':'days'), icon:'🏆', earned:days.length>=mark})),
  ];
  if(habit.unit==='km')for(const mark of [100,250,500,1000])badges.push({id:'km-'+mark,title:mark+' km club',
    detail:mark+' km logged over time',icon:'👟',earned:habit.totalValue>=mark});
  return {xp:days.length*10,current,longest,next,remaining:next-current,
    tier:current>=30?'Legendary streak':current>=7?'Super streak':current>=3?'On fire':current?'Building a streak':'Fresh start',
    comeback:current===0&&days.length>0,badges};
}

export function journeyRewards(habits, today) {
  const active=habits.filter(habit=>!habit.archived&&habit.startedOn<=today);
  const xp=habits.reduce((sum,habit)=>sum+(habit.rewards?.xp||0),0);
  const level=Math.floor(xp/100)+1;
  const date=new Date(today+'T12:00:00Z');
  const weekStart=rewardDay(today,-((date.getUTCDay()+6)%7));
  const weekEnd=rewardDay(weekStart,6);
  const days=new Set(active.flatMap(habit=>rewardDates(habit.history,habit.startedOn,today)));
  const week=Array.from({length:7},(_,i)=>{
    const day=rewardDay(weekStart,i);
    return {day,done:days.has(day),future:day>today,eligible:active.some(habit=>habit.startedOn<=day)};
  });
  const weekTarget=Math.min(5,week.filter(day=>day.eligible).length);
  const weekDone=week.filter(day=>day.done&&day.eligible).length;
  const todayDone=active.filter(habit=>habit.doneToday).length;
  const badges=habits.flatMap(habit=>(habit.rewards?.badges||[]).filter(badge=>badge.earned).map(badge=>
    ({...badge,key:habit.id+':'+badge.id,habitName:habit.name})));
  return {xp,level,levelProgress:xp%100,toNextLevel:100-xp%100,
    levelName:level>=20?'Trailblazer':level>=10?'Committed':level>=5?'Building momentum':level>=2?'Finding rhythm':'Getting started',
    todayDone,todayTotal:active.length,perfectDay:active.length>0&&todayDone===active.length,
    weekStart,weekEnd,week,weekTarget,weekDone,weekComplete:weekTarget>0&&weekDone>=weekTarget,badges};
}

export function rewardCelebration(before, after) {
  if(!before||!after||after.xp<=before.xp)return null;
  const gain=after.xp-before.xp;
  if(after.level>before.level)return {title:'Level '+after.level+' unlocked',detail:after.levelName+' · +'+gain+' XP'};
  if(after.perfectDay&&!before.perfectDay)return {title:'Perfect day!',detail:'Every habit completed · +'+gain+' XP'};
  const previous=new Set(before.badges.map(badge=>badge.key));
  const badge=after.badges.find(badge=>!previous.has(badge.key));
  if(badge)return {title:badge.title+' unlocked',detail:badge.habitName+' · +'+gain+' XP'};
  return {title:'Another day in the bank',detail:'Habit completed · +'+gain+' XP'};
}
