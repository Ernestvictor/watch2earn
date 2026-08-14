const fs = require('fs');
const path = require('path');

function readJSON(file){
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
}
function writeJSON(file, data){
  fs.writeFileSync(path.join(__dirname, '..', file), JSON.stringify(data, null, 2));
}

app.get('/postback/cpagrig', (req, res) => {
  const { subid, payout, status, key } = req.query;
  
  // 1. SECURITY CHECK - add this key in CPAgrip too
  const MY_SECRET_KEY = "ihrb4hru4bj3bhnvihbu485yji"; 
  if(key!== MY_SECRET_KEY){
    return res.status(403).send('Invalid key');
  }

  // 2. Only credit if status = 1 meaning completed
  if(status == '1' && subid && payout){
    try{
      let users = readJSON('data/users.json');
      let userKey = Object.keys(users).find(key => users[key].email === subid);

       const amoutNaira = parsefloat(payout) * 700; //
        
       users[userKey].balance = (users[userKey] .balance ||0) + amountNaira;
        // Log transaction
        let tx = readJSON('data/transactions.json');
        tx.push({user: subid, amount: amountNaira, source: 'CPAgrip', date: new Date()});
        writeJSON('data/transactions.json', tx);
        
        writeJSON('data/users.json', users);
        console.log(`Credited ${subid} with ₦${amountNaira}`);
      }
    } catch(e){
      console.log("Postback Error:", e);
      return res.status(500).send('Error');
    }
  }
  
  // 3. CPAgrip MUST get "OK" back
  res.send('OK'); 
})