import "dotenv/config";
import readline from "node:readline/promises";
import { Writable } from "node:stream";
import path from "node:path";
import bcrypt from "bcryptjs";
import { openDb } from "../src/db.js";
import { root } from "../src/config.js";
if (!process.stdin.isTTY)
  throw Error(
    "Execute em terminal interativo. Não passe senhas por argumentos.",
  );
let muted = false;
const output = new Writable({
  write(chunk, encoding, callback) {
    if (!muted) process.stdout.write(chunk, encoding);
    callback();
  },
});
const rl = readline.createInterface({
  input: process.stdin,
  output,
  terminal: true,
});
try {
  const name = (await rl.question("Nome do administrador: ")).trim();
  const registration = (
    await rl.question("Identificador de acesso (4–20 dígitos): ")
  ).trim();
  process.stdout.write("Senha (mínimo 12 caracteres; entrada oculta): ");
  muted = true;
  const password = await rl.question("");
  muted = false;
  process.stdout.write("\n");
  process.stdout.write("Confirme a senha: ");
  muted = true;
  const confirmation = await rl.question("");
  muted = false;
  process.stdout.write("\n");
  if (
    name.length < 3 ||
    name.length > 100 ||
    !/^\d{4,20}$/.test(registration) ||
    password.length < 12 ||
    Buffer.byteLength(password) > 72 ||
    password !== confirmation
  )
    throw Error("Dados inválidos ou confirmação diferente.");
  const db = openDb();
  try {
    await db.user.create({
      data: {
        name,
        registration,
        password_hash: await bcrypt.hash(password, 12),
        role: "admin",
        created_at: new Date(),
      },
    });
    console.log("Administrador criado. Entre pela tela de login.");
  } finally {
    await db.$disconnect();
  }
} catch {
  process.stdout.write(
    "\nNão foi possível criar: confira os dados e se o identificador já existe.\n",
  );
  process.exitCode = 1;
} finally {
  rl.close();
}
