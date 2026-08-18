const fs = require('fs');
const path = require('path');
const db = require('./database');

const SQL_SCRIPTS = [
  '-- 001_schema.sql.txt',
  '-- 002_tables_core_erp.sql.txt',
  '-- 002b_security_purchasing.sql.txt',
  '-- 010_agricultural_module.sql.txt',
  '-- 020_finance_module.sql.txt',
  '-- 021_finance_credits.sql.txt',
  '-- 022_credit_amortization.sql.txt',
  '-- 023_credit_installment_payments.sql.txt',
  '-- 024_finance_checks.sql.txt',
  '-- 025_finance_lpg.sql.txt',
  '-- 026_finance_account_cbu.sql.txt',
  '-- 027_arca_sisa_cpe.sql.txt',
  '-- 028_expand_account_type.sql.txt',
  '-- 030_hr_module.sql.txt',
  '-- 003_tables_precision_timeseries..txt',
  '-- 004_seed_demo.sql.txt',
  '--005 - KPI views.txt',
  '--SCRIPT 8 AUTHZ POR SCOPE.txt',
  '--SCRIPT 9 AUDITORIA AUTOMATICA.txt'
];

async function initializeDatabase() {
  console.log('🔧 Initializing Pampa Precision ERP Database...\n');
  const failures = [];
  
  try {
    for (const scriptName of SQL_SCRIPTS) {
      const filePath = path.join(__dirname, scriptName);
      
      if (!fs.existsSync(filePath)) {
        console.log(`⚠️  Skipping ${scriptName} (not found)`);
        continue;
      }

      console.log(`📄 Executing: ${scriptName}`);
      const sql = fs.readFileSync(filePath, 'utf-8');
      
      try {
        await db.query(sql);
        console.log(`✅ ${scriptName} completed\n`);
      } catch (error) {
        console.error(`❌ Error in ${scriptName}:`, error.message, '\n');
        failures.push({ scriptName, message: error.message });
      }
    }

    if (failures.length > 0) {
      console.error(`❌ Database initialization finished with ${failures.length} failed script(s).`);
      process.exitCode = 1;
    } else {
      console.log('✨ Database initialization completed!');
    }
    console.log('\n📊 Next steps:');
    console.log('  1. Verify tables were created: SELECT * FROM information_schema.tables;');
    console.log('  2. Start the server: npm start');
    console.log('  3. Open: http://localhost:3000\n');
    
    process.exit(failures.length > 0 ? 1 : 0);
  } catch (error) {
    console.error('❌ Fatal error during initialization:', error);
    process.exit(1);
  }
}

// Run initialization
initializeDatabase();
