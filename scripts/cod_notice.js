/* Shared plain-text COD notice contract. No payment or session operations. */
(function(root){
 'use strict';
 function normalize(value){
  if(!value||value.success!==true||typeof value.enabled!=='boolean'||typeof value.title!=='string'||typeof value.body!=='string')throw new Error('Respuesta de mensaje contraentrega no válida.');
  const title=value.title.trim(),body=value.body.replace(/\r\n?/g,'\n');
  if([...title].length>120||[...body].length>3000)throw new Error('El título permite hasta 120 caracteres y el contenido hasta 3.000.');
  if(/[\u0000-\u001f\u007f-\u009f]/.test(value.title)||/[\u0000-\u001f\u007f-\u009f]/.test(body.replace(/[\n\t]/g,'')))throw new Error('El texto contiene caracteres de control no permitidos.');
  if(value.enabled&&(!title||!body.trim()))throw new Error('Escribe un título y contenido antes de activar el mensaje.');
  return {enabled:value.enabled,title,body};
 }
 function escape(value){
  return String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 }
 function render(value){
  const notice=normalize({...value,success:true});
  let paragraph=[],list=[],out=[];
  const flushParagraph=()=>{if(paragraph.length){out.push('<p>'+paragraph.map(escape).join('<br>')+'</p>');paragraph=[]}};
  const flushList=()=>{if(list.length){out.push('<ul>'+list.map(text=>'<li>'+escape(text)+'</li>').join('')+'</ul>');list=[]}};
  for(const line of notice.body.split('\n')){
   if(!line.trim()){flushParagraph();flushList();continue}
   const bullet=line.match(/^\s*[-*•]\s+(.+)$/);
   if(bullet){flushParagraph();list.push(bullet[1])}
   else{flushList();paragraph.push(line)}
  }
  flushParagraph();flushList();
  return '<h4>'+escape(notice.title)+'</h4>'+out.join('');
 }
 root.CODNotice=Object.freeze({normalize,render});
})(globalThis);
