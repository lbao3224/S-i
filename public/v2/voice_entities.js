/* SỔ ƠI: tách ý định, tên người, sản phẩm, số và tiền trước khi quyết định hành động. */
(function(root) {
'use strict';
const titles='anh|chị|chi|dì|di|cô|co|chú|chu|bác|bac|ông|ong|bà|ba|cậu|cau|mợ|mo|em';
function fold(t) {return String(t||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').toLowerCase().trim();}
function classify(t) {
 const s=fold(t);
 if (/\b(thu no|tra no|thanh toan no)\b/.test(s)) return 'debt_payment';
 if (/\b(ghi no|ghi so|mua thieu|mua chiu|cho no|no tien|thieu tien)\b/.test(s) || /\bno\b/.test(s)) return 'debt';
 if (/^(?:them mon|tao mon|them san pham|tao san pham)\b/.test(s)) return 'product_create';
 if (/^(?:nhap(?: kho| hang)?|them(?: vao)? kho|them vao ton kho|tang ton kho|cong kho|bo vao kho)\b/.test(s)) return 'stock_in';
 if (/^(chi|xai|ton|mua da|mua muoi)\b/.test(s)) return 'expense';
 return 'sale';
}
const moneyTail=/(?:\s|^)(?:\d[\d.,]*|mot|hai|ba|bon|tu|nam|lam|sau|bay|tam|chin|muoi|chuc|tram|nghin|ngan|ngan|nghin|trieu|k|dong|d|ruoi|hai muoi|ba muoi)(?:\s+(?:\d[\d.,]*|mot|hai|ba|bon|tu|nam|lam|sau|bay|tam|chin|muoi|chuc|tram|nghin|ngan|trieu|k|dong|d|ruoi))*\s*$/i;
function extractPerson(t) {
 let x=String(t||'').replace(/[,;.!?]/g,' ').replace(/\s+/g,' ').trim();
 x=x.replace(/\b(?:ghi\s*nợ|ghi\s*sổ|mua\s*thiếu|mua\s*chịu|cho\s*nợ|nợ\s*tiền|thiếu\s*tiền|trả\s*nợ|thu\s*nợ|thanh\s*toán\s*nợ)\b/gi,' ').replace(/(?:^|\s)(?:nợ|thiếu|chịu)(?=\s|$)/gi,' ').replace(/\s+/g,' ').trim();
 // Bỏ tiền ở đuôi, kể cả "50", nhưng giữ số thuộc danh xưng "Anh 7" hoặc "Dì 6".
 const honorific=new RegExp('(?:^|\\s)('+titles+')\\s+([\\p{L}\\d]+(?:\\s+[\\p{L}\\d]+){0,3})','iu');
 const m=x.match(honorific);
 if(!m)return '';
 let words=(m[1]+' '+m[2]).trim().split(/\s+/);
 const currency=/^(ngàn|nghìn|ngàn|nghìn|k|ka|đồng|đ|triệu)$/i;
 const nums=/^(\d+[.,]?\d*|một|hai|ba|bốn|tư|năm|sáu|bảy|tám|chín|mười|chục|trăm|lăm|muoi)$/i;
 const moneyWord=/^(chục|trăm|ngàn|nghìn|triệu)$/i;
 let cut=words.length;
 for(let i=1;i<words.length;i++)if(currency.test(words[i])){cut=Math.min(cut,i);break;}
 if(cut<words.length && cut>1 && nums.test(words[cut-1]))cut--;
 words=words.slice(0,cut);
 while(words.length>2 && nums.test(words[words.length-1])) words.pop();
 while(words.length>2 && moneyWord.test(words[words.length-1]))words.pop();
 return words.join(' ').trim();
}
function matchPerson(t, people) {
 const target=fold(extractPerson(t));
 if(!target) return {name:'',customer:null,ambiguous:false};
 const matches=(people||[]).filter(c=>fold(c.name).split('(')[0].trim()===target);
 return {name:extractPerson(t),customer:matches.length===1?matches[0]:null,ambiguous:matches.length>1};
}
function stockItem(t) {
 // Luồng kho: không đưa động từ và số lượng vào tên sản phẩm.
 let x=String(t||'').trim().replace(/^(?:nhập(?:\s+kho|\s+hàng)?|thêm\s+(?:vào\s+)?kho|thêm\s+vào\s+tồn\s+kho|tăng\s+tồn\s+kho|cộng\s+kho|bỏ\s+vào\s+kho|thêm\s+món)\s*/iu,'').trim();
 const nums={'một':1,'hai':2,'ba':3,'bốn':4,'năm':5,'sáu':6,'bảy':7,'tám':8,'chín':9,'mười':10};
 let quantity=null;
 const number='(\\d+|một|hai|ba|bốn|năm|sáu|bảy|tám|chín|mười)';
 const leading=x.match(new RegExp('^'+number+'(?:\\s+(?:ly|bịch|bịt|chai|gói|cái|hộp|túi|phần|lon|kg|ký))?\\s+','iu'));
 if(leading) {quantity=Number(leading[1])||nums[fold(leading[1])]; x=x.slice(leading[0].length).trim();}
 if(quantity===null) {
  const trailing=x.match(new RegExp('\\s+'+number+'(?:\\s+(?:ly|bịch|bịt|chai|gói|cái|hộp|túi|phần|lon|kg|ký))?$','iu'));
  if(trailing) {quantity=Number(trailing[1])||nums[fold(trailing[1])];x=x.slice(0,trailing.index).trim();}
 }
 x=x.replace(/^(?:ly|bịch|bịt|chai|gói|cái|hộp|túi|phần|lon|kg|ký)\s+/iu,'').trim();
 return x ? {kind:'stock_in',quantity:quantity||1,name:x} : null;
}
function inspect(t,people) {const kind=classify(t);return Object.assign({kind},kind==='debt'?matchPerson(t,people):kind==='stock_in'?stockItem(t):{});}
function createItem(t) {
 let x=String(t||'').replace(/^(?:thêm món|tạo món|thêm sản phẩm|tạo sản phẩm)\s*/iu,'').trim();
 const m=x.match(/\s+(?:giá|giá bán)\s+(.+)$/iu);
 const priceText=m?m[1]:'';
 if(m)x=x.slice(0,m.index).trim();
 return {kind:'product_create',name:x,priceText};
}
root.SooiVoiceEntities={fold,classify,extractPerson,matchPerson,stockItem,createItem,inspect};
if(typeof module!=='undefined')module.exports=root.SooiVoiceEntities;
})(typeof window!=='undefined'?window:globalThis);
