import { OrderScreen } from "@/components/order-screen";
import { requirePageSession } from "@/lib/auth/page";

export default async function OrderPage({ params }: PageProps<"/orders/[id]">) {
  await requirePageSession("MANAGER", "STAFF");
  const { id } = await params;
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-4">
      <OrderScreen orderId={id} />
    </main>
  );
}
