import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma=new PrismaClient();

async function main(){
  const settings=await prisma.programSettings.upsert({
    where:{id:"default"},
    update:{},
    create:{
      programName:"Syntolk Partners",websiteUrl:"https://syntolk.ru",currency:"RUB",
      baseCommissionRate:20,cookieDays:60,commissionHoldDays:14,minimumPayoutAmount:5000,
      requireApproval:true,selfReferralBlocked:true,hideCustomerEmails:true,brandName:"Syntolk",
      companyName:"Syntolk",payoutMethods:["MANUAL"],payoutFrequency:"MONTHLY"
    }
  });

  const program=await prisma.program.upsert({
    where:{slug:"syntolk-main"},
    update:{},
    create:{name:"Основная партнёрская программа",slug:"syntolk-main",description:"20% с оплаченных продаж Syntolk, включая recurring.",commissionRate:20,cookieDays:60,currency:"RUB",isDefault:true,requireApproval:true,minimumPayoutAmount:5000}
  });

  const groups=[
    {name:"Блогеры",commissionRate:20,cookieDays:60,isDefault:true},
    {name:"Фрилансеры",commissionRate:20,cookieDays:60,isDefault:false},
    {name:"Агентства",commissionRate:25,cookieDays:90,isDefault:false},
    {name:"VIP партнёры",commissionRate:30,cookieDays:120,isDefault:false},
  ];
  for(const g of groups) await prisma.partnerGroup.upsert({where:{name:g.name},update:{programId:program.id},create:{...g,programId:program.id}});

  const templates=[
    {type:"WELCOME",name:"Код входа",subject:"Код входа Syntolk Partners",body:"<h2>Syntolk Partners</h2><p>Код подтверждения: <b>{{code}}</b></p>",variables:["code"]},
    {type:"PARTNER_APPLICATION",name:"Заявка получена",subject:"Заявка в Syntolk Partners получена",body:"<h2>Здравствуйте, {{name}}</h2><p>Ваша заявка получена.</p>",variables:["name"]},
    {type:"PARTNER_APPROVED",name:"Партнёр одобрен",subject:"Добро пожаловать в Syntolk Partners",body:"<h2>Здравствуйте, {{name}}</h2><p>Ваша заявка одобрена.</p>",variables:["name"]},
    {type:"PAYOUT_PAID",name:"Выплата выполнена",subject:"Syntolk Partners: выплата выполнена",body:"<h2>Выплата выполнена</h2><p>Сумма: {{amount}} ₽</p>",variables:["amount"]},
    {type:"REFUND_ADJUSTMENT",name:"Корректировка возврата",subject:"Syntolk Partners: корректировка комиссии",body:"<p>Комиссия скорректирована из-за возврата.</p>",variables:[]},
  ] as const;
  for(const t of templates){
    const existing=await prisma.emailTemplate.findFirst({where:{type:t.type}});
    if(!existing)await prisma.emailTemplate.create({data:t as any});
  }

  if(process.env.SEED_ADMIN_EMAIL&&process.env.SEED_ADMIN_PASSWORD){
    const email=process.env.SEED_ADMIN_EMAIL.toLowerCase();
    const passwordHash=await hash(process.env.SEED_ADMIN_PASSWORD,12);
    await prisma.account.upsert({where:{email},update:{role:"ADMIN",status:"ACTIVE",passwordHash},create:{email,name:process.env.SEED_ADMIN_NAME||"Syntolk Admin",passwordHash,role:"ADMIN",status:"ACTIVE",emailVerifiedAt:new Date()}});
  }

  console.log("Seeded",settings.programName,program.slug);
}

main().finally(()=>prisma.$disconnect());
