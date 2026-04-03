const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log("=== Face Profiles ===");
    console.log(await prisma.faceProfile.findMany());
    
    console.log("=== Attendance Logs ===");
    console.log(await prisma.attendanceLog.findMany({ 
        take: 5, 
        orderBy: { timestamp: 'desc' } 
    }));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
