const fs = require('fs');

const file = fs.readFileSync('pampaagro-erp.html', 'utf8');
const scriptStart = file.indexOf('<script>');
const scriptEnd = file.indexOf('</script>');

if (scriptStart >= 0 && scriptEnd > scriptStart) {
    const scriptContent = file.substring(scriptStart + 8, scriptEnd);
    
    let openBraces = 0, closeBraces = 0;
    let openParens = 0, closeParens = 0;
    let openBrackets = 0, closeBrackets = 0;
    
    for (let i = 0; i < scriptContent.length; i++) {
        const c = scriptContent[i];
        if (c === '{') openBraces++;
        else if (c === '}') closeBraces++;
        else if (c === '(') openParens++;
        else if (c === ')') closeParens++;
        else if (c === '[') openBrackets++;
        else if (c === ']') closeBrackets++;
    }
    
    console.log(`Llaves: ${openBraces} open, ${closeBraces} close, diff=${openBraces - closeBraces}`);
    console.log(`Paréntesis: ${openParens} open, ${closeParens} close, diff=${openParens - closeParens}`);
    console.log(`Brackets: ${openBrackets} open, ${closeBrackets} close, diff=${openBrackets - closeBrackets}`);
}
