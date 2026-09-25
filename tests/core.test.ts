import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { cloudPaymentsEventKey, parseCloudPaymentsBody, verifyCloudPaymentsSignature } from "../lib/cloudpayments";
import { calculateCommission, proratedReversal } from "../lib/commission-engine";

test("CloudPayments Content-HMAC validates raw URL-encoded body", () => {
  const secret="secret";
  const raw="Amount=100.00&AccountId=user%40example.com";
  const signature=createHmac("sha256",secret).update(raw,"utf8").digest("base64");
  assert.equal(verifyCloudPaymentsSignature(raw,{contentHmac:signature,xContentHmac:null},secret),true);
});

test("CloudPayments X-Content-HMAC validates decoded body", () => {
  const secret="secret";
  const raw="Amount=100.00&AccountId=user%40example.com";
  const decoded="Amount=100.00&AccountId=user@example.com";
  const signature=createHmac("sha256",secret).update(decoded,"utf8").digest("base64");
  assert.equal(verifyCloudPaymentsSignature(raw,{contentHmac:null,xContentHmac:signature},secret),true);
});

test("CloudPayments parser and event key are deterministic", () => {
  const payload=parseCloudPaymentsBody("TransactionId=123&Amount=49.90&AccountId=u1","application/x-www-form-urlencoded");
  assert.equal(payload.TransactionId,"123");
  assert.equal(payload.Amount,"49.90");
  assert.equal(cloudPaymentsEventKey("refund",{TransactionId:456}),"cloudpayments:refund:456");
});

test("refund reversal is proportional and capped", () => {
  assert.equal(proratedReversal({refundAmount:250,paymentAmount:1000,originalCommissionAmount:200}),-50);
  assert.equal(proratedReversal({refundAmount:2000,paymentAmount:1000,originalCommissionAmount:200}),-200);
  assert.equal(proratedReversal({refundAmount:100,paymentAmount:0,originalCommissionAmount:200}),0);
});

function fakeDb(rules:any[]=[]){
  return {
    programSettings:{upsert:async()=>({baseCommissionRate:20,commissionHoldDays:14})},
    commissionRule:{findMany:async()=>rules},
  };
}

test("commission engine applies matching percentage rule before fallback", async () => {
  const result=await calculateCommission(fakeDb([{id:"r1",name:"VIP campaign",type:"PERCENTAGE",value:30,conditions:{campaign:"vip"}}]),{
    amount:1000,currency:"RUB",partner:{id:"p1",programId:null,groupId:null,commissionRate:20,usesCustomCommission:false},referral:{campaign:"vip"}
  });
  assert.equal(result.amount,300);
  assert.equal(result.rate,30);
  assert.equal(result.ruleId,"r1");
});

test("commission engine applies fixed rule and caps it to payment amount", async () => {
  const result=await calculateCommission(fakeDb([{id:"r2",name:"Fixed",type:"FIXED",value:500,conditions:{}}]),{
    amount:300,currency:"RUB",partner:{id:"p1",programId:null,groupId:null,commissionRate:20,usesCustomCommission:false}
  });
  assert.equal(result.amount,300);
  assert.equal(result.rate,100);
});

test("commission fallback hierarchy is partner override then group then program then base", async () => {
  const custom=await calculateCommission(fakeDb(),{amount:1000,currency:"RUB",partner:{id:"p1",commissionRate:35,usesCustomCommission:true,group:{commissionRate:25},program:{commissionRate:22}}});
  assert.equal(custom.amount,350);assert.equal(custom.source,"partner_override");

  const group=await calculateCommission(fakeDb(),{amount:1000,currency:"RUB",partner:{id:"p1",commissionRate:20,usesCustomCommission:false,group:{commissionRate:25},program:{commissionRate:22}}});
  assert.equal(group.amount,250);assert.equal(group.source,"partner_group");

  const program=await calculateCommission(fakeDb(),{amount:1000,currency:"RUB",partner:{id:"p1",commissionRate:20,usesCustomCommission:false,program:{commissionRate:22}}});
  assert.equal(program.amount,220);assert.equal(program.source,"program");

  const base=await calculateCommission(fakeDb(),{amount:1000,currency:"RUB",partner:{id:"p1",commissionRate:20,usesCustomCommission:false}});
  assert.equal(base.amount,200);assert.equal(base.source,"program_settings");
});
