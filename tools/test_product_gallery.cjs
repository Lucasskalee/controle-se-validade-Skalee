const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { uniqueImages } = require('../product-gallery.js');
assert.equal(uniqueImages([
 {photoPath:'a.webp',photoUrl:'https://test/a?token=1'},
 {photoPath:'a.webp',photoUrl:'https://test/a?token=2'},
 {photoPath:'b.webp',photoUrl:'https://test/b'},
 {photoUrl:'javascript:alert(1)'}, {photoUrl:''}
]).length, 2);
const code = fs.readFileSync(require('node:path').join(__dirname,'../auth.js'),'utf8');
const method = code.slice(code.indexOf(' async loadProductGallery(product) {'),code.indexOf('\n updateCatalogProductPhoto,', code.indexOf(' async loadProductGallery(product) {')));
let queries = 0;
const tables = {
 validity_products: [
  {product_code:'F7',photo_path:'a.webp'}, {product_code:'F7',photo_path:'a.webp'},
  {product_code:'F7',photo_path:'b.webp'}, {product_code:'F7',photo_path:'',photo:'https://test/removed'},
  {product_code:'7',photo_path:'wrong.webp'}, {product_code:'F70',photo_path:'wrong2.webp'}
 ],
 catalog_products: [{internal_code:'F7',photo_path:'a.webp'},{internal_code:'F7',photo_path:null,image_url:'https://test/reference'}]
};
const context = vm.createContext({Map,Set,Date,Promise,console,activeUserId:'user1',productGalleryCache:new Map(),getProductPhotoUrl:async path=>'https://test/'+path,supabase:{from(table){
 queries++;
 let rows=tables[table];
 const q={select:()=>q,eq:(key,value)=>{rows=rows.filter(r=>r[key]===value);return q;},order:()=>q,limit:n=>{rows=rows.slice(0,n);return q;},then:resolve=>Promise.resolve({data:rows,error:null}).then(resolve)};
 return q;
}}});
vm.runInContext(`globalThis.api = {${method}}`,context);
(async()=>{
 const result=await context.api.loadProductGallery({code:'F7'});
 assert.equal(result.images.length,3);
 assert.ok(result.images.every(i=>!i.photoUrl.includes('wrong')&&!i.photoUrl.includes('removed')));
 assert.equal(result.partial,false);
 await context.api.loadProductGallery({code:'F7'});
 assert.equal(queries,2,'Repeat opening should reuse cache');
 await context.api.loadProductGallery({});
 assert.equal(queries,2,'No code/catalog must not fetch unrelated photos');
 context.activeUserId='user2';
 await context.api.loadProductGallery({code:'F7'});
 assert.equal(queries,4,'Cache must be isolated by user');
 console.log('PASS: exact F7 matching, unique paths, removed photos excluded, reference image, user cache isolation, no unfiltered query.');
})().catch(e=>{console.error(e);process.exitCode=1;});
