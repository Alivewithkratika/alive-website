const express = require("express");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const { google } = require("googleapis");
const { Resend } = require("resend");

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3000;
const AMOUNT = 299900; // ₹2,999 in paise
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB = process.env.GOOGLE_SHEET_TAB || "Sheet1";
const OWNER = process.env.OWNER_EMAIL || "alive.withkratika@gmail.com";
const FRONTEND = (process.env.FRONTEND_ORIGIN || "").replace(/\/+$/, "");
const API_URL = (process.env.API_PUBLIC_URL || "").replace(/\/+$/, "");
const required = ["RAZORPAY_KEY_ID","RAZORPAY_KEY_SECRET","RAZORPAY_WEBHOOK_SECRET","GOOGLE_SHEET_ID","GOOGLE_SERVICE_ACCOUNT_JSON","RESEND_API_KEY","EMAIL_FROM","FRONTEND_ORIGIN","API_PUBLIC_URL"];
const missing = required.filter(k => !process.env[k]);
let razorpay, sheets, resend;
try {
  if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)
    razorpay = new Razorpay({key_id:process.env.RAZORPAY_KEY_ID,key_secret:process.env.RAZORPAY_KEY_SECRET});
  if (process.env.RESEND_API_KEY) resend = new Resend(process.env.RESEND_API_KEY);
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
      scopes:["https://www.googleapis.com/auth/spreadsheets"]
    });
    sheets = google.sheets({version:"v4",auth});
  }
} catch(e) { console.error("Configuration error:",e.message); }

const headers = ["Registration Date","Client Name","Email","Phone / WhatsApp","Occupation","Reason for Joining","Goals","Payment Status","Amount Received","Razorpay Payment ID","Registration Reference","Payment Link ID","Client Email Status","Owner Email Status","Paid At","Webhook Event ID"];
const range = s => `'${TAB.replace(/'/g,"''")}'!${s}`;
const clean = (v,n=1200) => String(v || "").trim().slice(0,n);
const esc = s => String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function ready(res) {
  if (missing.length || !razorpay || !sheets || !resend) {
    res.status(503).json({error:"Payment service configuration is incomplete. Please contact ALIVE."}); return false;
  }
  return true;
}
async function ensureHeaders() {
  const r=await sheets.spreadsheets.values.get({spreadsheetId:SHEET_ID,range:range("A1:P1")});
  const old=(r.data.values||[[]])[0];
  await sheets.spreadsheets.values.update({spreadsheetId:SHEET_ID,range:range("A1:P1"),valueInputOption:"RAW",requestBody:{values:[headers.map((v,i)=>old[i]||v)]}});
}
async function findRow(ref) {
  const r=await sheets.spreadsheets.values.get({spreadsheetId:SHEET_ID,range:range("K2:K")});
  const i=(r.data.values||[]).findIndex(x=>x[0]===ref); return i<0?null:i+2;
}
async function readRow(n) {
  const r=await sheets.spreadsheets.values.get({spreadsheetId:SHEET_ID,range:range(`A${n}:P${n}`)});
  return (r.data.values||[[]])[0];
}
async function writeRow(n,row) {
  await sheets.spreadsheets.values.update({spreadsheetId:SHEET_ID,range:range(`A${n}:P${n}`),valueInputOption:"USER_ENTERED",requestBody:{values:[row]}});
}
async function emailClient(name,email) {
 const text=`Hi ${name||"there"},\n\nWelcome to ALIVE! ✨\n\nWe're happy to confirm that we've received your payment of ₹2,999 and your registration for the Two-Day ALIVE Experience is confirmed.\n\nThank you for taking this step towards yourself. We're excited to have you join us for this experience.\n\nWhat happens next?\nOur ALIVE team will reach out to you soon with the next steps and details you'll need before the experience.\n\nUntil then, gather the dreams you've tucked away, the things you've always wanted to do, and the little pieces of yourself you've been waiting to rediscover. It's time to dream for yourself again. ✨\n\nWarmly,\nTeam ALIVE\nCoaching with Kratika Songara\nStop Existing. Start Living.`;
 const html=`<p>Hi ${esc(name||"there")},</p><p>Welcome to ALIVE! ✨</p><p>We're happy to confirm that we've received your payment of <strong>₹2,999</strong> and your registration for the <strong>Two-Day ALIVE Experience</strong> is confirmed.</p><p>Thank you for taking this step towards yourself. We're excited to have you join us for this experience.</p><p><strong>What happens next?</strong><br>Our ALIVE team will reach out to you soon with the next steps and details you'll need before the experience.</p><p>Until then, gather the dreams you've tucked away, the things you've always wanted to do, and the little pieces of yourself you've been waiting to rediscover. It's time to dream for yourself again. ✨</p><p>Warmly,<br>Team ALIVE<br>Coaching with Kratika Songara<br><strong>Stop Existing. Start Living.</strong></p>`;
 const r=await resend.emails.send({from:process.env.EMAIL_FROM,to:email,subject:"You're Registered! Welcome to the ALIVE Experience ✨",text,html});
 if(r.error) throw new Error(r.error.message||"Client email failed");
}
async function emailOwner(row,paymentId,ref) {
 const labels=["Name","Email","Phone / WhatsApp","Occupation","Reason for joining","Goals"];
 const vals=[row[1],row[2],row[3],row[4],row[5],row[6]];
 const text=`New ALIVE Experience registration — payment verified\nAmount: ₹2,999 INR\n${labels.map((l,i)=>l+": "+(vals[i]||"")).join("\n")}\nRazorpay Payment ID: ${paymentId}\nRegistration Reference: ${ref}`;
 const html=`<h2>New paid ALIVE Experience registration</h2><p><strong>Payment verified: ₹2,999 INR</strong></p><ul>${labels.map((l,i)=>`<li><strong>${l}:</strong> ${esc(vals[i])}</li>`).join("")}<li><strong>Razorpay Payment ID:</strong> ${esc(paymentId)}</li><li><strong>Registration Reference:</strong> ${esc(ref)}</li></ul>`;
 const r=await resend.emails.send({from:process.env.EMAIL_FROM,to:OWNER,subject:"New paid registration — ALIVE Experience",text,html});
 if(r.error) throw new Error(r.error.message||"Owner email failed");
}

// Razorpay requires the exact raw body for webhook signature verification.
app.post("/webhooks/razorpay",express.raw({type:"application/json"}),async(req,res)=>{
 if(!razorpay||!sheets||!resend||!process.env.RAZORPAY_WEBHOOK_SECRET) return res.status(503).send("Not configured");
 const sig=req.get("x-razorpay-signature")||"";
 const expected=crypto.createHmac("sha256",process.env.RAZORPAY_WEBHOOK_SECRET).update(req.body).digest("hex");
 if(sig.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected))) return res.status(400).send("Invalid signature");
 let event; try{event=JSON.parse(req.body.toString("utf8"));}catch{return res.status(400).send("Invalid JSON");}
 if(event.event!=="payment_link.paid") return res.status(200).send("Ignored");
 const linkId=event.payload?.payment_link?.entity?.id;
 const ref=event.payload?.payment_link?.entity?.reference_id;
 const paymentId=event.payload?.payment?.entity?.id;
 const eventId=clean(event.id,200);
 if(!linkId||!ref||!paymentId) return res.status(400).send("Missing identifiers");
 try{
   const [link,payment]=await Promise.all([razorpay.paymentLink.fetch(linkId),razorpay.payments.fetch(paymentId)]);
   if(link.status!=="paid"||Number(link.amount)!==AMOUNT||link.currency!=="INR"||link.reference_id!==ref||
      payment.status!=="captured"||Number(payment.amount)!==AMOUNT||payment.currency!=="INR"||payment.payment_link!==linkId)
      return res.status(400).send("Payment verification failed");
   const n=await findRow(ref);
   if(!n){console.error("Verified payment has no matching registration",ref);return res.status(200).send("Manual review required");}
   const row=await readRow(n);
   // Stored statuses avoid normal repeat-webhook emails. Google Sheets is not transactional,
   // so strict exactly-once delivery requires a database/outbox.
   if(row[7]==="Paid"&&row[9]===paymentId&&row[15]===eventId) return res.status(200).send("Already processed");
   row[7]="Paid"; row[8]=2999; row[9]=paymentId; row[10]=ref; row[11]=linkId; row[14]=new Date().toISOString(); row[15]=eventId;
   await writeRow(n,row);
   if(row[12]!=="Sent"){
     try{await emailClient(row[1],row[2]);row[12]="Sent";}
     catch(e){row[12]="Failed";console.error("Client email error:",e.message);}
     await writeRow(n,row);
   }
   if(row[13]!=="Sent"){
     try{await emailOwner(row,paymentId,ref);row[13]="Sent";}
     catch(e){row[13]="Failed";console.error("Owner email error:",e.message);}
     await writeRow(n,row);
   }
   return res.status(200).send("Payment verified and registration updated");
 }catch(e){console.error("Webhook processing error:",e.message);return res.status(500).send("Retry later");}
});

app.use(express.json({limit:"30kb"}));
const hits=new Map();
app.post("/api/register",async(req,res)=>{
 const ip=req.ip||"unknown",now=Date.now(),old=(hits.get(ip)||[]).filter(t=>now-t<600000);
 if(old.length>=12)return res.status(429).json({error:"Too many attempts. Please try again later."});
 old.push(now);hits.set(ip,old);
 if(!ready(res))return;
 const b=req.body||{};
 if(clean(b.website,100))return res.status(400).json({error:"Invalid submission"});
 const name=clean(b.name,120),email=clean(b.email,254).toLowerCase(),phone=clean(b.phone,40);
 const occupation=clean(b.occupation,150),reason=clean(b.reason,1200),goals=clean(b.goals||b.goal,1200);
 if(!name||!phone||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
   return res.status(400).json({error:"Enter your name, a valid email, and phone/WhatsApp number."});
 const ref="ALIVE_"+Date.now()+"_"+crypto.randomBytes(5).toString("hex");
 try{
   await ensureHeaders();
   const link=await razorpay.paymentLink.create({
     amount:AMOUNT,currency:"INR",accept_partial:false,description:"Two-Day ALIVE Experience registration",
     reference_id:ref,customer:{name,email,contact:phone.replace(/[^\d+]/g,"").slice(0,15)},
     notify:{sms:false,email:false},reminder_enable:false,
     callback_url:`${API_URL}/payment-return`,callback_method:"get",
     notes:{registration_reference:ref,occupation:occupation.slice(0,255)}
   });
   const row=[new Date().toISOString(),name,email,phone,occupation,reason,goals,"Pending",0,"",ref,link.id,"Pending","Pending","",""];
   await sheets.spreadsheets.values.append({spreadsheetId:SHEET_ID,range:range("A:P"),valueInputOption:"USER_ENTERED",insertDataOption:"INSERT_ROWS",requestBody:{values:[row]}});
   return res.status(201).json({paymentUrl:link.short_url,referenceId:ref});
 }catch(e){console.error("Registration error:",e.message);return res.status(500).json({error:"We couldn't start registration. Please try again or contact ALIVE."});}
});
app.get("/payment-return",(_req,res)=>res.redirect(`${FRONTEND}/offer.html?payment=processing`));
app.get("/",(_req,res)=>res.json({service:"ALIVE payment API",status:missing.length?"needs_configuration":"ready"}));
app.use((err,_req,res,_next)=>{console.error(err.message);res.status(500).json({error:"Unexpected server error"});});
app.listen(PORT,()=>console.log(`ALIVE payment API listening on ${PORT}; missing env vars: ${missing.join(", ")||"none"}`));
