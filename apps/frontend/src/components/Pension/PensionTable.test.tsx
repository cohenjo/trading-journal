import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import PensionTable from "./PensionTable";

const mockAccounts = [
  {
    id: "1",
    owner: "You",
    name: "Migdal Pension",
    value: 450000,
    details: { deposits: 3500, earnings: 12000, fees: 180, insurance_fees: 95 },
  },
  {
    id: "2",
    owner: "Partner",
    name: "Menora Fund",
    value: 320000,
    details: { deposits: 2800, earnings: 8500, fees: 150, insurance_fees: 70 },
  },
];

describe("PensionTable", () => {
  it("renders account rows with correct data", () => {
    render(<PensionTable accounts={mockAccounts} />);

    expect(screen.getByText("Migdal Pension")).toBeInTheDocument();
    expect(screen.getByText("Menora Fund")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2 data rows
  });

  it("shows empty state when no accounts", () => {
    render(<PensionTable accounts={[]} />);

    expect(
      screen.getByText(/no pension data available/i)
    ).toBeInTheDocument();
  });

  it("calls onDelete when delete button is clicked", () => {
    const onDelete = vi.fn();
    render(<PensionTable accounts={mockAccounts} onDelete={onDelete} />);

    const deleteButtons = screen.getAllByTitle("Delete");
    fireEvent.click(deleteButtons[0]);

    expect(onDelete).toHaveBeenCalledWith("1", "Migdal Pension");
  });

  it("does not render delete buttons when onDelete is not provided", () => {
    render(<PensionTable accounts={mockAccounts} />);

    expect(screen.queryByTitle("Delete")).not.toBeInTheDocument();
  });

  it("calls onToggleOwner when owner badge is clicked", () => {
    const onToggleOwner = vi.fn();
    render(
      <PensionTable accounts={mockAccounts} onToggleOwner={onToggleOwner} />
    );

    const ownerBadge = screen.getByText("You");
    fireEvent.click(ownerBadge);

    expect(onToggleOwner).toHaveBeenCalledWith("1", "You");
  });

  it("renders owner badges with correct styling", () => {
    render(<PensionTable accounts={mockAccounts} />);

    const youBadge = screen.getByText("You");
    const partnerBadge = screen.getByText("Partner");

    expect(youBadge.className).toContain("bg-blue-500");
    expect(partnerBadge.className).toContain("bg-purple-500");
  });
});
